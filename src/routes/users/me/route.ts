import { Effect, Schema } from "effect"
import { Route } from "../../../router/Route.js"

export let meHits = 0

export const GET = Route.get(
  "getUsersMe",
  { success: Schema.Struct({ id: Schema.String, source: Schema.String }) },
  () =>
    Effect.sync(() => {
      meHits += 1
      return { id: "me", source: "static" }
    })
)
