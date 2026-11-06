import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { CurrentUser } from "../src/auth.ts"
import { applicationLayer } from "../src/application.ts"
import { routerConfig } from "../../src/router/config.ts"
import { makeApiLive } from "../src/routes.gen.ts"
import { meHits } from "../src/routes/users/me/route.ts"
import { launch, request } from "./launch.ts"

const text = (response: Response) => response.text()

describe("http api", () => {
  let web: ReturnType<typeof launch>

  beforeEach(() => {
    web = launch()
  })

  afterEach(async () => {
    await web.dispose()
  })

  it("lists and reads users", async () => {
    const list = await web.handler(request("GET", "/users"))
    assert.equal(list.status, 200)
    assert.deepEqual(await list.json(), [{ id: "1", name: "Ada" }])

    const user = await web.handler(request("GET", "/users/1"))
    assert.equal(user.status, 200)
    assert.deepEqual(await user.json(), { id: "1", name: "Ada" })
  })

  it("returns the declared not-found error", async () => {
    const response = await web.handler(request("GET", "/users/missing"))
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { _tag: "UserNotFound", id: "missing" })
  })

  it("creates, updates, and deletes a user", async () => {
    const created = await web.handler(request("POST", "/users", JSON.stringify({ name: "Grace" }), {
      "content-type": "application/json"
    }))
    assert.equal(created.status, 200)
    const body = await created.json()
    assert.equal(body.name, "Grace")

    const updated = await web.handler(request("PATCH", `/users/${body.id}`, JSON.stringify({ name: "Grace H" }), {
      "content-type": "application/json"
    }))
    assert.equal(updated.status, 200)
    assert.deepEqual(await updated.json(), { id: body.id, name: "Grace H" })

    const removed = await web.handler(request("DELETE", `/users/${body.id}`))
    assert.equal(removed.status, 204)
    assert.equal(await text(removed), "")

    const missing = await web.handler(request("GET", `/users/${body.id}`))
    assert.equal(missing.status, 404)
  })

  it("rejects a payload that fails the schema with an empty 400", async () => {
    const response = await web.handler(request("POST", "/users", JSON.stringify({ name: 1 }), {
      "content-type": "application/json"
    }))
    assert.equal(response.status, 400)
    assert.equal(await text(response), "")
  })

  it("returns an empty 404 for an unregistered method", async () => {
    const response = await web.handler(request("PUT", "/users"))
    assert.equal(response.status, 404)
    assert.equal(await text(response), "")
  })

  it("does not normalize trailing slashes, duplicate slashes, or case", async () => {
    const list = await web.handler(request("GET", "/users"))
    assert.equal(list.status, 200)
    const trailing = await web.handler(request("GET", "/users/"))
    assert.notEqual(trailing.status, 200)

    const me = await web.handler(request("GET", "/users/me"))
    assert.equal(me.status, 200)
    const meSlash = await web.handler(request("GET", "/users/me/"))
    assert.equal(meSlash.status, 404)
    assert.equal(await text(meSlash), "")

    const duplicate = await web.handler(request("GET", "/users//1"))
    assert.equal(duplicate.status, 404)
    assert.equal(await text(duplicate), "")

    const cased = await web.handler(request("GET", "/Users/1"))
    assert.equal(cased.status, 404)
    assert.equal(await text(cased), "")
  })

  it("prefers a static segment over a dynamic one", async () => {
    const response = await web.handler(request("GET", "/users/me"))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: "me", source: "static" })
  })

  it("runs the GET handler for HEAD", async () => {
    const before = meHits
    const response = await web.handler(request("HEAD", "/users/me"))
    assert.equal(response.status, 200)
    assert.equal(meHits, before + 1)
  })

  it("leaves OPTIONS unmatched", async () => {
    const response = await web.handler(request("OPTIONS", "/users"))
    assert.equal(response.status, 404)
    assert.equal(await text(response), "")
  })

  it("renders a defect as 500", async () => {
    const response = await web.handler(request("GET", "/boom"))
    assert.equal(response.status, 500)
  })

  it("rejects a missing bearer token with 401", async () => {
    const response = await web.handler(request("GET", "/me"))
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { _tag: "Unauthorized" })
  })

  it("reads the per-request user even when startup provides CurrentUser", async () => {
    await web.dispose()
    const startup = applicationLayer(makeApiLive()).pipe(
      Layer.provide(Layer.succeed(CurrentUser, { id: "startup" }))
    )
    web = HttpRouter.toWebHandler(startup, { disableLogger: true, routerConfig })
    const response = await web.handler(request("GET", "/me", undefined, {
      authorization: "Bearer request-user"
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: "request-user" })
  })
})
