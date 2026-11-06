import { Effect } from "effect"
import { Schema } from "effect"
import { User, UserNotFoundResponse, Users, getUserById } from "../domain.ts"
import { Route } from "return"

export const GET = Route.get(
  "getUser",
  {
    params: { id: Schema.String },
    success: User,
    error: UserNotFoundResponse
  },
  ({ params }) => getUserById(params.id)
)

export const PATCH = Route.patch(
  "updateUser",
  {
    params: { id: Schema.String },
    payload: Schema.Struct({ name: Schema.String }),
    success: User,
    error: UserNotFoundResponse
  },
  ({ params, payload }) =>
    Effect.gen(function*() {
      const users = yield* Users
      return yield* users.update(params.id, payload.name)
    })
)

export const DELETE = Route.delete(
  "deleteUser",
  {
    params: { id: Schema.String },
    error: UserNotFoundResponse
  },
  ({ params }) =>
    Effect.gen(function*() {
      const users = yield* Users
      yield* users.remove(params.id)
    })
)
