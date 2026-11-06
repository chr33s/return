import { Probe, readProbe } from "../tree/services.ts"
import { Route } from "../../router/Route.ts"

export const GET = Route.get("probeLeft", { success: Probe }, () => readProbe("left"))
