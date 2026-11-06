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

  const finish = (graph: Graph) => {
    if (graph.done !== undefined) return graph.done
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

  const reload = async () => {
    const generated = await options.generate()
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
    const next: Graph = { ...loaded, inflight: 0, retiring: false, disposed: false }
    const previous = current
    current = next
    if (previous !== undefined) retire(previous)
  }

  const dispose = async () => {
    const graph = current
    current = undefined
    if (graph !== undefined) {
      graph.retiring = true
      await finish(graph)
    }
  }

  return { reload, handle, dispose }
}
