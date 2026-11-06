import { Probe, readProbe } from "../../tree/services.ts"
import { Route } from "../../../../../src/router/Route.ts"

export const GET = Route.get("probeRebuilt", { success: Probe }, () => readProbe("rebuilt"))
