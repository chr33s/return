import { HttpRouter } from "effect/http"
import { routerConfig } from "@chr33s/return"
import { applicationLayer } from "../src/application.ts"
import { makeApiLive } from "../src/routes.gen.ts"

export const launch = (options?: Parameters<typeof makeApiLive>[0]) => {
  const layer = applicationLayer(makeApiLive(options))
  return HttpRouter.toWebHandler(layer, { disableLogger: true, routerConfig })
}

export const request = (method: string, path: string, body?: string, headers?: HeadersInit) =>
  new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    body
  })
