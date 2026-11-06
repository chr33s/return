import type { Context } from "effect"
import { Effect } from "effect"
import { HttpApiEndpoint, HttpApiMiddleware } from "effect/http-api"

export const RouteTypeId = "~return/Route"

const methodNames = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
export type RouteMethodName = (typeof methodNames)[number]

type OptionKey = "params" | "query" | "headers" | "payload" | "success" | "error"

type AcceptOptions<O> = keyof O extends OptionKey ? O : never

type ValueType<S> = S extends ReadonlyArray<infer Item> ? Item extends { readonly Type: infer T } ? T : never
  : S extends { readonly Type: infer T } ? T
  : S extends Readonly<Record<string, { readonly Type: any }>> ? {
      readonly [K in keyof S]: S[K] extends { readonly Type: infer T } ? T : never
    }
  : never

type SuccessOf<O> = [O] extends [object]
  ? "success" extends keyof O ? [O["success"]] extends [undefined] ? void : ValueType<Exclude<O["success"], undefined>>
  : void
  : void

type ErrorOf<O> = [O] extends [object]
  ? "error" extends keyof O ? [O["error"]] extends [undefined] ? never : ValueType<Exclude<O["error"], undefined>>
  : never
  : never

type Part<O, K extends OptionKey, Name extends string> = K extends keyof O
  ? [O[K]] extends [undefined] ? {}
  : { readonly [P in Name]: ValueType<Exclude<O[K], undefined>> }
  : {}

export type RouteInput<O> =
  & Part<O, "params", "params">
  & Part<O, "query", "query">
  & Part<O, "headers", "headers">
  & Part<O, "payload", "payload">

type MiddlewareList = readonly Context.Key<any, any>[]

type ApplyAll<E, M extends MiddlewareList> = M extends readonly [infer Head, ...infer Rest]
  ? Head extends Context.Key<infer I, any>
    ? I extends HttpApiMiddleware.AnyId
      ? Rest extends MiddlewareList ? ApplyAll<HttpApiEndpoint.AddMiddleware<E, I>, Rest>
      : E
    : E
  : E
  : E

/**
 * Adds a descriptor's middleware tags to an `HttpApiEndpoint` without widening
 * the endpoint type. Generated code calls this with the middleware list.
 */
export const applyEndpointMiddleware = <E, M extends MiddlewareList>(
  endpoint: E,
  middleware: M
): ApplyAll<E, M> => {
  let current: any = endpoint
  for (const tag of middleware) current = current.middleware(tag)
  return current
}

export interface AnyRoute {
  readonly [RouteTypeId]: {
    readonly method: RouteMethodName
    readonly operationId: string
  }
  readonly operationId: string
  readonly method: RouteMethodName
  readonly options: {
    readonly params?: unknown
    readonly query?: unknown
    readonly headers?: unknown
    readonly payload?: unknown
    readonly success?: unknown
    readonly error?: unknown
  }
  readonly middlewares: readonly Context.Key<any, any>[]
}

export const isRoute = (u: unknown): u is AnyRoute => {
  if (typeof u !== "object" || u === null || !(RouteTypeId in u)) return false
  const method = (u as { readonly method?: unknown }).method
  return typeof method === "string" && methodNames.includes(method as RouteMethodName)
}

type Handler<O, R> = (input: RouteInput<O>) => Effect.Effect<SuccessOf<O>, ErrorOf<O>, R>

const define = <const Method extends RouteMethodName>(method: Method) =>
<const Id extends string, const Options, R>(
  operationId: Id,
  options: AcceptOptions<Options>,
  handler: Handler<Options, R>
) => {
  const assemble = <R2, const M extends MiddlewareList>(middlewares: M, _requirements: R2) => {
    const descriptor = {
      [RouteTypeId]: { method, operationId },
      operationId,
      method,
      options,
      middlewares,
      handler: handler as unknown as Handler<Options, R2>,
      middleware<I extends HttpApiMiddleware.AnyId, S>(tag: Context.Key<I, S>) {
        const next = [...middlewares, tag] as const
        return assemble<
          HttpApiMiddleware.ApplyServices<I, R2>,
          readonly [...M, typeof tag]
        >(next as never, undefined as never)
      }
    }
    return descriptor
  }
  return assemble<R, readonly []>([] as const, undefined as never)
}

/**
 * Declares a GET endpoint. The directory is the path. `options` is the
 * `HttpApiEndpoint` set of `params`, `query`, `headers`, `payload`, `success`,
 * and `error`. There is no `path`, `status`, or `disableCodecs` field.
 */
export const get = define("GET")

/** POST endpoint. Same arguments as {@link get}. */
export const post = define("POST")

/** PUT endpoint. Same arguments as {@link get}. */
export const put = define("PUT")

/** PATCH endpoint. Same arguments as {@link get}. */
export const patch = define("PATCH")

/** DELETE endpoint. Same arguments as {@link get}. */
export const del = define("DELETE")

export const Route = {
  get,
  post,
  put,
  patch,
  delete: del
}
