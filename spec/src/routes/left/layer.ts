import { Layer } from "effect"
import { Database, leftDatabase } from "../tree/services.ts"

export const Live = Layer.succeed(Database, leftDatabase)
