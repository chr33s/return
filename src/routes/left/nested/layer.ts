import { Layer } from "effect"
import { OnlyLeft } from "../../tree/services.js"

export const Live = Layer.succeed(OnlyLeft, { id: "only-left" })
