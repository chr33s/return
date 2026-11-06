import { watch } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { HttpRouter } from "effect/http"
import { register } from "tsx/esm/api"
import { applicationLayer } from "../application.js"
import { generateProject } from "./generate.js"
import { listen } from "./listen.js"
import { observeBuild } from "./observe-build.js"
import { createReloadController } from "./reload.js"
import { routerConfig } from "./config.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const routesDir = path.join(projectRoot, "src/routes")
const outFile = path.join(projectRoot, "src/routes.gen.ts")

let generation = 0

const loadGraph = async () => {
  const namespace = `routes-${++generation}`
  const api = register({ namespace })
  let releaseNamespace = true
  let disposeWeb: (() => Promise<void>) | undefined
  try {
    const mod = await api.import("../routes.gen.ts", import.meta.url) as {
      makeApiLive: () => unknown
    }
    const watched = observeBuild(applicationLayer(mod.makeApiLive() as never))
    const web = HttpRouter.toWebHandler(watched.layer as never, { disableLogger: true, routerConfig })
    disposeWeb = web.dispose
    await watched.ready
    releaseNamespace = false
    return {
      handler: web.handler,
      dispose: async () => {
        await web.dispose()
        await api.unregister()
      }
    }
  } catch (error) {
    if (disposeWeb !== undefined) await disposeWeb()
    throw error
  } finally {
    if (releaseNamespace) await api.unregister()
  }
}

export const startDevHost = async () => {
  const controller = createReloadController({
    generate: async () => {
      const namespace = `generate-${++generation}`
      const api = register({ namespace })
      try {
        return await generateProject({
          routesDir,
          outFile,
          projectRoot,
          importer: (file) => api.import(pathToFileURL(file).href, import.meta.url)
        })
      } finally {
        await api.unregister()
      }
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
