import { Probe, readProbe } from "../tree/services.ts"
import { Route } from "../../../../src/router/Route.ts"

export const GET = Route.get("probeRight", { success: Probe }, () => readProbe("right"))
