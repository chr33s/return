import { Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { RequireUserLive } from "../src/auth.ts"
import { routerConfig } from "../src/router/config.ts"
import { makeApiLive } from "../src/routes.gen.ts"
import { AuditLogLive, UsersLive } from "../src/routes/users/domain.ts"
import { Captured, Database, rootDatabase } from "../src/routes/tree/services.ts"
import { request } from "./launch.ts"

const events: string[] = []

const counter = (name: string, fail = false) =>
  Layer.effectDiscard(Effect.gen(function*() {
    events.push(`build:${name}`)
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      events.push(`release:${name}`)
    }))
    if (fail) yield* Effect.fail(`${name} failed`)
  }))

const sites = (failNested = false) => ({
  ".": counter("."),
  "left": counter("left"),
  "left/nested": counter("left/nested", failNested),
  "left/rebuilt": counter("left/rebuilt"),
  "users": counter("users")
})

const serve = (failNested = false) => {
  const layer = makeApiLive({ providers: sites(failNested) }).pipe(
    Layer.provide(RequireUserLive),
    HttpRouter.provideRequest(AuditLogLive),
    HttpRouter.provideRequest(UsersLive),
    HttpRouter.provideRequest(Layer.succeed(Database, rootDatabase)),
    HttpRouter.provideRequest(Layer.succeed(Captured, { id: "app", database: rootDatabase })),
    Layer.provide(HttpServer.layerServices)
  )
  return HttpRouter.toWebHandler(layer, { disableLogger: true, routerConfig })
}

const builds = () => events.filter(event => event.startsWith("build:"))

describe("lifecycle", () => {
  it("builds each directory layer once per graph", async () => {
    events.length = 0
    const web = serve()
    try {
      assert.equal((await web.handler(request("GET", "/users/me"))).status, 200)
      assert.equal((await web.handler(request("GET", "/users/me"))).status, 200)
      assert.deepEqual(builds().filter(event => event === "build:users"), ["build:users"])
      assert.deepEqual(builds().filter(event => event === "build:."), ["build:."])
      assert.deepEqual(builds().filter(event => event === "build:left"), ["build:left"])
      assert.ok(events.indexOf("build:.") < events.indexOf("build:left"))
      assert.ok(events.indexOf("build:left") < events.indexOf("build:left/nested"))
    } finally {
      await web.dispose()
    }
    assert.ok(events.indexOf("release:left/nested") < events.indexOf("release:left"))
    assert.ok(events.indexOf("release:left/rebuilt") < events.indexOf("release:left"))
    assert.ok(events.indexOf("release:left") < events.indexOf("release:."))
    assert.ok(events.indexOf("release:users") < events.indexOf("release:."))
  })

  it("releases only the failed graph", async () => {
    events.length = 0
    const running = serve()
    assert.equal((await running.handler(request("GET", "/boom"))).status, 500)
    const before = [...events]
    const outer: string[] = []
    const failed = serve(true)
    const exit = await Effect.runPromise(Effect.gen(function*() {
      const scope = yield* Scope.make()
      yield* Scope.addFinalizer(scope, Effect.sync(() => {
        outer.push("outer")
      }))
      const result = yield* Effect.exit(Effect.promise(() => failed.handler(request("GET", "/users/me"))))
      assert.deepEqual(outer, [])
      yield* Scope.close(scope, Exit.void)
      return result
    }))
    await failed.dispose()
    assert.equal(Exit.isFailure(exit), true)
    assert.deepEqual(outer, ["outer"])
    assert.deepEqual(events.slice(0, before.length), before)
    assert.ok(events.includes("build:left/nested"))
    assert.ok(events.includes("release:left/nested"))
    assert.ok(events.includes("release:."))
    assert.equal(events.filter(event => event === "release:.").length, 1)
    await running.dispose()
    assert.equal(events.filter(event => event === "release:.").length, 2)
  })
})
