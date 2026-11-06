import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { dispatch } from "./dispatch.ts"
import { createReturnHost, type ReturnHostOptions } from "./host.ts"
import { defaultPrefix, normalizePrefix } from "./prefix.ts"

export interface ReturnViteOptions extends ReturnHostOptions {
  /** Requests under this prefix are the file router. Default `/api`. */
  readonly prefix?: string
}

interface OpenHost {
  readonly close: () => Promise<void>
}

/**
 * One origin for a Vite SPA and this file router.
 *
 * On Vite 7 and 8, `use` inside `configureServer` runs after the host check and
 * before Vite's transform, static, and HTML middleware. Returning a function
 * would install the API after the HTML fallback, and an API 404 would become
 * the SPA. Vite 6 runs this hook before the host check, so the peer range
 * starts at 7.
 *
 * A restart builds the next server before `closeServer` runs, so the oldest
 * host is the one that closes.
 */
export const returnVite = (options: ReturnViteOptions): Plugin => {
  const prefix = normalizePrefix(options.prefix ?? defaultPrefix)
  const devHosts: OpenHost[] = []
  const previewHosts: OpenHost[] = []
  const api = (handle: (request: Request) => Promise<Response>, base: string) =>
    (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
      void dispatch(req, res, next, { prefix, base, handler: handle }).catch(error => {
        console.error(error)
        if (!res.headersSent && !res.writableEnded) {
          res.statusCode = 500
          res.end()
        }
      })
    }

  return {
    name: "return",
    async configureServer(server) {
      const host = createReturnHost(options, true)
      devHosts.push(host)
      server.middlewares.use(api(host.handle, server.config.base))
      await host.ready()
    },
    async closeServer() {
      await devHosts.shift()?.close()
    },
    async configurePreviewServer(server) {
      const host = createReturnHost(options, false)
      previewHosts.push(host)
      server.middlewares.use(api(host.handle, server.config.base))
      await host.ready()
    },
    async closePreviewServer() {
      await previewHosts.shift()?.close()
    }
  }
}
