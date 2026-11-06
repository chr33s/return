import { Effect, Schema } from "effect"
import { AuditLog, User, Users } from "./domain.ts"
import { Route } from "../../router/Route.ts"

export const GET = Route.get(
  "listUsers",
  { success: Schema.Array(User) },
  () =>
    Effect.gen(function*() {
      const users = yield* Users
      return yield* users.list()
    })
)

export const POST = Route.post(
  "createUser",
  {
    payload: Schema.Struct({ name: Schema.String }),
    success: User
  },
  ({ payload }) =>
    Effect.gen(function*() {
      const users = yield* Users
      const audit = yield* AuditLog
      const user = yield* users.create(payload.name)
      yield* audit.record(`create ${user.id}`)
      return user
    })
)
