import { Effect } from "effect"
import { Route } from "@chr33s/return"

export const GET = Route.get("boom", {}, () => Effect.die("boom"))
