import { Probe, readProbe } from "../tree/services.ts"
import { Route } from "@chr33s/return"

export const GET = Route.get("probeLeft", { success: Probe }, () => readProbe("left"))
