import { Probe, readProbe } from "../tree/services.ts"
import { Route } from "return"

export const GET = Route.get("probeRight", { success: Probe }, () => readProbe("right"))
