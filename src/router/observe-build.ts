import { Effect, Layer } from "effect"

/** Resolves when a layer has built and rejects when that build fails. */
export const observeBuild = <A, E, R>(layer: Layer.Layer<A, E, R>) => {
  let settled = false
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const ready = new Promise<void>((succeed, fail) => {
    resolve = succeed
    reject = fail
  })
  const watched = layer.pipe(
    Layer.tap(() =>
      Effect.sync(() => {
        if (settled) return
        settled = true
        resolve()
      })
    ),
    Layer.tapCause(cause =>
      Effect.sync(() => {
        if (settled) return
        settled = true
        reject(cause)
      })
    )
  )
  return { layer: watched as Layer.Layer<A, E, R>, ready }
}
