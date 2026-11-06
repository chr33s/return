import { Effect } from "effect"
import { Route } from "../../router/Route.js"

export const GET = Route.get("boom", {}, () => Effect.die("boom"))
