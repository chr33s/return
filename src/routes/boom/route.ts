import { Effect } from "effect"
import { Route } from "../../router/Route.ts"

export const GET = Route.get("boom", {}, () => Effect.die("boom"))
