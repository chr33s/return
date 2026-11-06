import { Effect } from "effect"
import { Route } from "return"

export const GET = Route.get("boom", {}, () => Effect.die("boom"))
