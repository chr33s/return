import { Effect, Layer, Schema } from "effect"
import type { FileSystem } from "effect/FileSystem"
import type { Path } from "effect/Path"
import type { Generator } from "effect/http/Etag"
import type { HttpPlatform } from "effect/http/HttpPlatform"
import type { HttpRouter } from "effect/http"
import { RequireUser } from "../src/auth.js"
import { Route } from "../src/router/Route.js"
import { ApiLive, makeApiLive } from "../src/routes.gen.js"
import { AuditLog, Users } from "../src/routes/users/domain.js"

type Services<L> = L extends Layer.Layer<infer _A, infer _E, infer R> ? R : never
type Unwrap<R> = R extends any ? R extends HttpRouter.Request<any, infer S> ? Unwrap<S> : R : never
type Platform = FileSystem | Path | HttpPlatform | Generator | HttpRouter.HttpRouter
type Needs = Exclude<Unwrap<Services<typeof ApiLive>>, Platform>

type _Audit = AuditLog extends Needs ? true : never
type _UsersAbsent = Users extends Needs ? never : true
type _Auth = RequireUser extends Needs ? true : never
const _audit: _Audit = true
const _usersAbsent: _UsersAbsent = true
const _auth: _Auth = true

declare function launch(layer: Layer.Layer<never, never, Platform>): void

// @ts-expect-error ApiLive still requires AuditLog and RequireUser
launch(ApiLive)

const dropped = makeApiLive({
  providers: {
    users: Layer.empty
  }
})

type DroppedNeeds = Exclude<Unwrap<Services<typeof dropped>>, Platform | AuditLog | RequireUser>
type _DroppedUsers = Users extends DroppedNeeds ? true : never
const _droppedUsers: _DroppedUsers = true

declare function launchWithoutUsers(layer: Layer.Layer<never, never, Platform | AuditLog | RequireUser>): void

// @ts-expect-error dropping the users layer leaves Users required
launchWithoutUsers(dropped)

makeApiLive({
  providers: {
    // @ts-expect-error unknown provider site
    missing: Layer.empty
  }
})

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String
}) {}

export const wider = Route.get(
  "wider",
  { error: UserNotFound },
  // @ts-expect-error wider than the declared error
  () => Effect.fail("nope" as const)
)

// @ts-expect-error disableCodecs is not a route option
export const codecs = Route.get("codecs", { disableCodecs: true }, () => Effect.void)
