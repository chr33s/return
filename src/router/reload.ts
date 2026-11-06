export interface RunningGraph {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

export interface ReloadControllerOptions {
  readonly generate: () => Promise<{ readonly changed: boolean, readonly diagnostics: readonly string[] }>
  readonly load: () => Promise<RunningGraph>
  readonly drainMs?: number
  readonly log?: (line: string) => void
  readonly schedule?: (fn: () => void, ms: number) => { readonly cancel: () => void }
}

interface Graph extends RunningGraph {
  inflight: number
  retiring: boolean
  disposed: boolean
  done?: Promise<void>
  timer?: { readonly cancel: () => void }
}

export const drainMsDefault = 5000

export const createReloadController = (options: ReloadControllerOptions) => {
  const drainMs = options.drainMs ?? drainMsDefault
  const log = options.log ?? ((line: string) => console.error(line))
  const schedule = options.schedule ?? ((fn, ms) => {
    const timer = setTimeout(fn, ms)
    return { cancel: () => clearTimeout(timer) }
  })
  let current: Graph | undefined
  let running: Promise<void> | undefined
  let again = false
  let stopped = false
  const draining = new Set<Graph>()

  const finish = (graph: Graph) => {
    if (graph.done !== undefined) return graph.done
    draining.delete(graph)
    graph.disposed = true
    graph.timer?.cancel()
    graph.done = graph.dispose()
    return graph.done
  }

  const retire = (graph: Graph) => {
    graph.retiring = true
    if (graph.inflight === 0) {
      finish(graph)
      return
    }
    draining.add(graph)
    graph.timer = schedule(() => finish(graph), drainMs)
  }

  const handle = async (request: Request): Promise<Response> => {
    const graph = current
    if (graph === undefined) return new Response(null, { status: 503 })
    graph.inflight += 1
    try {
      return await graph.handler(request)
    } finally {
      graph.inflight -= 1
      if (graph.retiring && graph.inflight === 0) finish(graph)
    }
  }

  const attempt = async () => {
    if (stopped) return
    let generated: { readonly changed: boolean, readonly diagnostics: readonly string[] }
    try {
      generated = await options.generate()
    } catch (error) {
      log(error instanceof Error ? error.message : String(error))
      return
    }
    if (stopped) return
    if (generated.diagnostics.length > 0) {
      for (const line of generated.diagnostics) log(line)
      return
    }
    if (!generated.changed && current !== undefined) return
    let loaded: RunningGraph
    try {
      loaded = await options.load()
    } catch (error) {
      log(error instanceof Error ? error.message : String(error))
      return
    }
    if (stopped) {
      await loaded.dispose().catch(error => {
        log(error instanceof Error ? error.message : String(error))
      })
      return
    }
    const next: Graph = { ...loaded, inflight: 0, retiring: false, disposed: false }
    const previous = current
    current = next
    if (previous !== undefined) retire(previous)
  }

  const reload = () => {
    if (stopped) return Promise.resolve()
    if (running !== undefined) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          if (stopped) return
          again = false
          await attempt()
        } while (again && !stopped)
      } finally {
        running = undefined
      }
    })()
    return running
  }

  const dispose = async () => {
    stopped = true
    const inflight = running
    if (inflight !== undefined) await inflight
    const graph = current
    current = undefined
    const pending = [...draining]
    const waits: Array<Promise<void>> = []
    if (graph !== undefined) {
      graph.retiring = true
      waits.push(finish(graph))
    }
    for (const retired of pending) waits.push(finish(retired))
    await Promise.all(waits)
  }

  return { reload, handle, dispose }
}
