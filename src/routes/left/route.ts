import { Probe, readProbe } from "../tree/services.js"
import { Route } from "../../router/Route.js"

export const GET = Route.get("probeLeft", { success: Probe }, () => readProbe("left"))
