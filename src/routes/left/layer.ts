import { Layer } from "effect"
import { Database, leftDatabase } from "../tree/services.js"

export const Live = Layer.succeed(Database, leftDatabase)
