import { Context, Effect, Layer, Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String
}) {}

export const UserNotFoundResponse = UserNotFound.pipe(HttpApiSchema.status(404))

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})
export type User = typeof User.Type

export class Users extends Context.Service<Users, {
  readonly list: () => Effect.Effect<ReadonlyArray<User>>
  readonly get: (id: string) => Effect.Effect<User, UserNotFound>
  readonly create: (name: string) => Effect.Effect<User>
  readonly update: (id: string, name: string) => Effect.Effect<User, UserNotFound>
  readonly remove: (id: string) => Effect.Effect<void, UserNotFound>
}>()("app/Users") {}

/** Intentionally provided by the application layer, not by any directory Live. */
export class AuditLog extends Context.Service<AuditLog, {
  readonly record: (message: string) => Effect.Effect<void>
}>()("app/AuditLog") {}

export const getUserById = (id: string) =>
  Effect.gen(function*() {
    const users = yield* Users
    return yield* users.get(id)
  })

export const createUsers = (): Context.Service.Shape<typeof Users> => {
  const rows = new Map<string, User>([["1", { id: "1", name: "Ada" }]])
  let next = 2
  const missing = (id: string) => Effect.fail(new UserNotFound({ id }))
  return {
    list: () => Effect.succeed([...rows.values()]),
    get: (id) => {
      const user = rows.get(id)
      return user === undefined ? missing(id) : Effect.succeed(user)
    },
    create: (name) => {
      const user = { id: String(next++), name }
      rows.set(user.id, user)
      return Effect.succeed(user)
    },
    update: (id, name) => {
      const user = rows.get(id)
      if (user === undefined) return missing(id)
      const nextUser = { id, name }
      rows.set(id, nextUser)
      return Effect.succeed(nextUser)
    },
    remove: (id) => rows.delete(id) ? Effect.void : missing(id)
  }
}

export const UsersLive = Layer.sync(Users, createUsers)

export const AuditLogLive = Layer.succeed(AuditLog, {
  record: () => Effect.void
})
