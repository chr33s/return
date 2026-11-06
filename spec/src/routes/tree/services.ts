import { Context, Effect, Schema } from "effect"

export interface DatabaseShape {
  readonly id: string
  readonly token: object
}

export class Database extends Context.Service<Database, DatabaseShape>()("app/Database") {}

export interface CapturedShape {
  readonly id: string
  readonly database: DatabaseShape
}

export class Captured extends Context.Service<Captured, CapturedShape>()("app/Captured") {}

export interface OnlyLeftShape {
  readonly id: string
}

export class OnlyLeft extends Context.Service<OnlyLeft, OnlyLeftShape>()("app/OnlyLeft") {}

export const rootDatabase: DatabaseShape = { id: "root", token: {} }
export const leftDatabase: DatabaseShape = { id: "left", token: {} }

export const Probe = Schema.Struct({
  databaseId: Schema.String,
  capturedId: Schema.String,
  capturedDatabaseId: Schema.String,
  sameDatabase: Schema.Boolean,
  hasOnlyLeft: Schema.Boolean
})

export const seen: Array<{
  readonly at: string
  readonly database: DatabaseShape
  readonly captured: CapturedShape
  readonly onlyLeft: OnlyLeftShape | undefined
}> = []

export const readProbe = (at: string) =>
  Effect.gen(function*() {
    const database = yield* Database
    const captured = yield* Captured
    const services = yield* Effect.context<never>()
    const onlyLeft = Context.getOrUndefined(services as Context.Context<OnlyLeft>, OnlyLeft)
    seen.push({ at, database, captured, onlyLeft })
    return {
      databaseId: database.id,
      capturedId: captured.id,
      capturedDatabaseId: captured.database.id,
      sameDatabase: database === captured.database,
      hasOnlyLeft: onlyLeft !== undefined
    }
  })
