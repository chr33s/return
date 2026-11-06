import { Probe, readProbe } from "../../tree/services.ts"
import { Route } from "../../../../../src/router/Route.ts"

export const GET = Route.get("probeNested", { success: Probe }, () => readProbe("nested"))
