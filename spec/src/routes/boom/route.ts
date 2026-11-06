import { Effect } from "effect"
import { Route } from "../../../../src/router/Route.ts"

export const GET = Route.get("boom", {}, () => Effect.die("boom"))
