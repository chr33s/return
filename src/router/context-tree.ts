import { Context, Effect, Exit, Layer, Scope } from "effect"

/**
 * Builds one directory layer inside a scope nested in `parentScope`.
 * The parent context is provided so ancestor layers are not built again.
 * The directory context is the parent context plus this layer's output;
 * on a duplicate tag the child's value wins.
 */
type Out<L> = L extends Layer.Layer<infer A, infer _E, infer _R> ? A : never
type Err<L> = L extends Layer.Layer<infer _A, infer E, infer _R> ? E : never
type In<L> = L extends Layer.Layer<infer _A, infer _E, infer R> ? R : never

export const buildDirectory = <P, L>(
  parentScope: Scope.Scope,
  parentContext: Context.Context<P>,
  layer: L
): Effect.Effect<Context.Context<P | Out<L>>, Err<L>, Exclude<In<L>, P | Scope.Scope>> =>
  Effect.gen(function*() {
    const childScope = yield* Scope.fork(parentScope)
    const provided = Layer.provide(layer as never, Layer.succeedContext(parentContext))
    const built = yield* Effect.exit(Layer.buildWithScope(provided, childScope))
    if (Exit.isFailure(built)) {
      yield* Scope.close(childScope, built)
      return yield* Effect.failCause(built.cause)
    }
    return Context.merge(parentContext, built.value) as Context.Context<P | Out<L>>
  }) as Effect.Effect<Context.Context<P | Out<L>>, Err<L>, Exclude<In<L>, P | Scope.Scope>>

type AsLayer<S> = S extends Layer.Layer<infer A, infer E, infer R> ? Layer.Layer<A, E, R> : never

type ProviderValue<P, K extends string> = [P] extends [undefined]
  ? never
  : K extends keyof NonNullable<P> ? NonNullable<P>[K]
  : never

/** Services both layers provide, with the requirements and errors of either. */
type EitherLayer<L, S> = Layer.Layer<Out<L> & Out<S>, Err<L> | Err<S>, In<L> | In<S>>

type Chosen<P, K extends string, L> = [ProviderValue<P, K>] extends [never] ? L
  : [AsLayer<NonNullable<ProviderValue<P, K>>>] extends [never] ? L
  : undefined extends ProviderValue<P, K>
    ? EitherLayer<L, AsLayer<NonNullable<ProviderValue<P, K>>>>
    : AsLayer<ProviderValue<P, K>>

/**
 * Uses a test substitute for a provider site when that key is present, and
 * the production layer otherwise. A required key's type is the substitute
 * alone, so a substitute that drops a service does not keep the production
 * output. An optional key may be either layer, so its type provides only
 * the services both provide.
 */
export const selectSite = <L, P, const K extends string>(
  production: L,
  providers: P,
  key: K
): Chosen<P, K, L> => {
  if (providers !== undefined && providers !== null && typeof providers === "object" && key in providers) {
    const value = (providers as Record<string, unknown>)[key]
    if (Layer.isLayer(value)) return value as Chosen<P, K, L>
  }
  return production as Chosen<P, K, L>
}
