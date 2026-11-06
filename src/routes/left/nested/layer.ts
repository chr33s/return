import { Layer } from "effect"
import { OnlyLeft } from "../../tree/services.ts"

export const Live = Layer.succeed(OnlyLeft, { id: "only-left" })
