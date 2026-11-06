import { watch } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { HttpRouter } from "effect/http"
import { applicationLayer } from "../application.ts"
import { generateProject } from "./generate.ts"
import { listen } from "./listen.ts"
import { observeBuild } from "./observe-build.ts"
import { createReloadController } from "./reload.ts"
import { routerConfig } from "./config.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const routesDir = path.join(projectRoot, "src/routes")
const outFile = path.join(projectRoot, "src/routes.gen.ts")

let generation = 0
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

const loadGraph = async () => {
  ensureReloadHooks()
  const mod = await importGeneration(outFile, String(++generation)) as {
    makeApiLive: () => unknown
  }
  const watched = observeBuild(applicationLayer(mod.makeApiLive() as never))
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

export const startDevHost = async () => {
  ensureReloadHooks()
  const controller = createReloadController({
    generate: () => {
      const gen = String(++generation)
      return generateProject({
        routesDir,
        outFile,
        projectRoot,
        importer: (file) => importGeneration(file, gen)
      })
    },
    load: loadGraph
  })
  const server = listen(controller.handle)
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(routesDir, { recursive: true }, () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      void controller.reload()
    }, 50)
  })
  await controller.reload()
  const shutdown = async () => {
    watcher.close()
    if (timer !== undefined) clearTimeout(timer)
    server.close()
    await controller.dispose()
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
  return { server, controller, watcher }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) await startDevHost()
