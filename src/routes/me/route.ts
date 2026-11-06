import { Effect, Schema } from "effect"
import { CurrentUser, RequireUser } from "../../auth.js"
import { Route } from "../../router/Route.js"

export const GET = Route.get(
  "getMe",
  { success: Schema.Struct({ id: Schema.String }) },
  () =>
    Effect.gen(function*() {
      const user = yield* CurrentUser
      return { id: user.id }
    })
).middleware(RequireUser)
