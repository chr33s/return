import { Effect, Layer } from "effect"
import { Captured, Database, rootDatabase } from "./tree/services.ts"

const captured = Layer.effect(
  Captured,
  Effect.gen(function*() {
    const database = yield* Database
    return { id: "root-captured", database }
  })
)

export const Live = captured.pipe(Layer.provideMerge(Layer.succeed(Database, rootDatabase)))
