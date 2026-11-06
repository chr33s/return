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
 * `configureServer` runs before Vite's internal middleware. Calling `use` here
 * prepends the API. Returning a function would install it afterwards, and an
 * API 404 would fall through to the SPA.
 *
 * A restart builds the next server before `closeServer` runs, so the oldest
 * host is the one that closes.
 */
export const returnVite = (options: ReturnViteOptions): Plugin => {
  const prefix = normalizePrefix(options.prefix ?? defaultPrefix)
  const devHosts: OpenHost[] = []
  const previewHosts: OpenHost[] = []
  const api = (handle: (request: Request) => Promise<Response>) =>
    (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
      void dispatch(req, res, next, { prefix, handler: handle })
    }

  return {
    name: "return",
    async configureServer(server) {
      const host = createReturnHost(options, true)
      devHosts.push(host)
      server.middlewares.use(api(host.handle))
      await host.ready()
    },
    async closeServer() {
      await devHosts.shift()?.close()
    },
    async configurePreviewServer(server) {
      const host = createReturnHost(options, false)
      previewHosts.push(host)
      server.middlewares.use(api(host.handle))
      await host.ready()
    },
    async closePreviewServer() {
      await previewHosts.shift()?.close()
    }
  }
}
