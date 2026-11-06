import { Effect, Layer } from "effect"
import { Captured, Database } from "../../tree/services.js"

export const Live = Layer.effect(
  Captured,
  Effect.gen(function*() {
    const database = yield* Database
    return { id: "rebuilt", database }
  })
)
