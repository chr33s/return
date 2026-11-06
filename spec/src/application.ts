import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { RequireUserLive } from "./auth.ts"
import { AuditLogLive } from "./routes/users/domain.ts"

export const applicationLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provide(RequireUserLive),
    HttpRouter.provideRequest(AuditLogLive),
    Layer.provide(HttpServer.layerServices)
  )
