import { createServer } from "node:http"
import { dispatch } from "./dispatch.ts"
import { defaultPrefix, normalizePrefix } from "./prefix.ts"

export interface ListenOptions {
  readonly prefix?: string
  /** Built SPA directory (`vite build` output). */
  readonly dist: string
  readonly handler: (request: Request) => Promise<Response>
  readonly host?: string
  readonly port?: number
}

/** Prefix split, then `dist`, then `index.html` for client routes. `vite build` stays static. */
export const listen = (options: ListenOptions) => {
  const prefix = normalizePrefix(options.prefix ?? defaultPrefix)
  const server = createServer((req, res) => {
    void dispatch(req, res, undefined, {
      prefix,
      handler: options.handler,
      dist: options.dist
    })
  })
  server.listen(options.port ?? 3000, options.host ?? "127.0.0.1")
  return server
}
