import { watch, type FSWatcher } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { HttpRouter } from "effect/http"
import { generateProject } from "../router/generate.ts"
import { observeBuild } from "../router/observe-build.ts"
import { createReloadController } from "../router/reload.ts"
import { routerConfig } from "../router/config.ts"

export interface ReturnHostOptions {
  readonly routesDir: string
  readonly outFile: string
  readonly projectRoot?: string
  /** Layer passed to `HttpRouter.toWebHandler`. The host builds, swaps, and disposes it. */
  readonly createLayer: (mod: { readonly makeApiLive: () => unknown }) => unknown
  readonly log?: (line: string) => void
}

let hooksReady = false

const ensureReloadHooks = () => {
  if (hooksReady) return
  hooksReady = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? ""
      let gen = ""
      try {
        gen = new URL(parent).searchParams.get("gen") ?? ""
      } catch {
        gen = ""
      }
      const resolved = nextResolve(specifier, context)
      if (gen === "" || !resolved.url.startsWith("file:") || resolved.url.includes("/node_modules/")) {
        return resolved
      }
      const url = new URL(resolved.url)
      if (url.searchParams.get("gen") === gen) return resolved
      url.searchParams.set("gen", gen)
      return { ...resolved, url: url.href }
    }
  })
}

const importGeneration = (file: string, gen: string) => {
  const url = pathToFileURL(file)
  url.searchParams.set("gen", gen)
  return import(url.href)
}

export const createReturnHost = (options: ReturnHostOptions, watchRoutes: boolean) => {
  ensureReloadHooks()
  const projectRoot = options.projectRoot ?? process.cwd()
  const routesDir = path.resolve(projectRoot, options.routesDir)
  const outFile = path.resolve(projectRoot, options.outFile)
  const hostToken = crypto.randomUUID()
  let generation = 0
  let watcher: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined

  const log = options.log ?? ((line: string) => console.error(line))
  const controller = createReloadController({
    log,
    generate: () => {
      const gen = String(++generation)
      return generateProject({
        routesDir,
        outFile,
        projectRoot,
        importer: (file) => importGeneration(file, `${hostToken}.${gen}`)
      })
    },
    load: async () => {
      const mod = await importGeneration(outFile, `${hostToken}.${++generation}`) as {
        makeApiLive: () => unknown
      }
      const watched = observeBuild(options.createLayer(mod) as never)
      const web = HttpRouter.toWebHandler(watched.layer as never, { disableLogger: true, routerConfig })
      try {
        await watched.ready
      } catch (error) {
        await web.dispose()
        throw error
      }
      return {
        handler: web.handler,
        dispose: () => web.dispose()
      }
    }
  })

  if (watchRoutes) {
    watcher = watch(routesDir, { recursive: true }, () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        void controller.reload().catch(error => {
          log(error instanceof Error ? error.message : String(error))
        })
      }, 50)
    })
  }

  return {
    handle: controller.handle,
    ready: () => controller.reload(),
    close: async () => {
      if (timer !== undefined) clearTimeout(timer)
      watcher?.close()
      await controller.dispose()
    }
  }
}
