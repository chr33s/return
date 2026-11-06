import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { RequireUserLive } from "./auth.js"
import { AuditLogLive } from "./routes/users/domain.js"

export const applicationLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provide(RequireUserLive),
    HttpRouter.provideRequest(AuditLogLive),
    Layer.provide(HttpServer.layerServices)
  )
