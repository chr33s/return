import { Effect, Schema } from "effect"
import { CurrentUser, RequireUser } from "../../auth.ts"
import { Route } from "../../../../src/router/Route.ts"

export const GET = Route.get(
  "getMe",
  { success: Schema.Struct({ id: Schema.String }) },
  () =>
    Effect.gen(function*() {
      const user = yield* CurrentUser
      return { id: user.id }
    })
).middleware(RequireUser)
