import { Probe, readProbe } from "../tree/services.ts"
import { Route } from "return"

export const GET = Route.get("probeLeft", { success: Probe }, () => readProbe("left"))
