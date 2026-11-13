import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { applyEndpointMiddleware, Route, routerConfig } from "../src/index.ts"
import { createReturnHost } from "../src/vite/host.ts"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})

const listUsers = Route.get(
  "listUsers",
  { success: Schema.Array(User) },
  () => Effect.succeed([{ id: "1", name: "Ada" }])
)

const getUser = Route.get(
  "getUser",
  {
    params: { id: Schema.String },
    success: User
  },
  ({ params }) => Effect.succeed({ id: params.id, name: "Ada" })
)

const Api = HttpApi.make("Api").add(
  HttpApiGroup.make("routes").add(
    applyEndpointMiddleware(
      HttpApiEndpoint.get(listUsers.operationId, "/users", listUsers.options),
      listUsers.middlewares
    ),
    applyEndpointMiddleware(
      HttpApiEndpoint.get(getUser.operationId, "/users/:id", getUser.options),
      getUser.middlewares
    )
  )
)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(
    HttpApiBuilder.group(Api, "routes", (handlers) =>
      handlers
        .handle(listUsers.operationId, (request) => listUsers.handler(request))
        .handle(getUser.operationId, (request) => getUser.handler(request))
    )
  )
)

const layer = ApiLive.pipe(Layer.provide(HttpServer.layerServices))

const request = (path: string) => new Request(`http://127.0.0.1${path}`)

describe("single file", () => {
  it("serves a hand-written ApiLive without the generator", async () => {
    const web = HttpRouter.toWebHandler(layer, { disableLogger: true, routerConfig })
    try {
      const list = await web.handler(request("/users"))
      assert.equal(list.status, 200)
      assert.deepEqual(await list.json(), [{ id: "1", name: "Ada" }])

      const user = await web.handler(request("/users/1"))
      assert.equal(user.status, 200)
      assert.deepEqual(await user.json(), { id: "1", name: "Ada" })

      const missing = await web.handler(request("/missing"))
      assert.equal(missing.status, 404)
    } finally {
      await web.dispose()
    }
  })

  it("serves that ApiLive from the vite host", async () => {
    const host = createReturnHost({ layer }, false)
    try {
      await host.ready()
      const response = await host.handle(request("/users"))
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), [{ id: "1", name: "Ada" }])
    } finally {
      await host.close()
    }
  })
})
