import { HttpRouter } from "effect/http"
import { applicationLayer } from "./application.ts"
import { routerConfig } from "./router/config.ts"
import { listen } from "./router/listen.ts"
import { observeBuild } from "./router/observe-build.ts"
import { ApiLive } from "./routes.gen.ts"

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
