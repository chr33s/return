import { HttpRouter } from "effect/http"
import { applicationLayer } from "./application.js"
import { routerConfig } from "./router/config.js"
import { listen } from "./router/listen.js"
import { observeBuild } from "./router/observe-build.js"
import { ApiLive } from "./routes.gen.js"

const watched = observeBuild(applicationLayer(ApiLive))
const web = HttpRouter.toWebHandler(watched.layer, { disableLogger: true, routerConfig })

try {
  await watched.ready
} catch (error) {
  console.error(error)
  await web.dispose()
  process.exit(1)
}

const server = listen(web.handler)

const shutdown = async () => {
  server.close()
  await web.dispose()
  process.exit(0)
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())
