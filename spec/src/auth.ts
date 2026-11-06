import { Context, Effect, Layer, Redacted } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

export class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("app/CurrentUser") {}

/**
 * `provides` is a type parameter on Effect 4.1. `HttpApiMiddleware.Service` does
 * not accept `provides` in its options object.
 */
export class RequireUser extends HttpApiMiddleware.Service<RequireUser, { provides: CurrentUser }>()(
  "app/RequireUser",
  {
    error: HttpApiError.Unauthorized,
    security: { bearer: HttpApiSecurity.bearer }
  }
) {}

export const RequireUserLive = Layer.succeed(RequireUser, {
  bearer: (effect, { credential }) => {
    const token = Redacted.value(credential)
    if (token === "") return Effect.fail(new HttpApiError.Unauthorized())
    return effect.pipe(Effect.provideService(CurrentUser, { id: token }))
  }
})
