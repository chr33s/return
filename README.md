# @chr33s/return

`@chr33s/return` builds an Effect 4.1 `HttpApi`. `Route.get`, `Route.post`, `Route.put`, `Route.patch`, and `Route.delete` declare handlers. The file router is optional.

## One file

A single file builds `HttpApi` and `ApiLive` by hand and does not run `return-generate`. The URL is the path argument of `HttpApiEndpoint`. There is one root scope, because nothing discovers a `layer.ts`. `main` and `@chr33s/return/vite` take that `ApiLive` the same way they take a generated one.

```ts
// src/api.ts
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { applyEndpointMiddleware, Route } from "@chr33s/return"

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

export const Api = HttpApi.make("Api").add(
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

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(
    HttpApiBuilder.group(Api, "routes", (handlers) =>
      handlers
        .handle(listUsers.operationId, (request) => listUsers.handler(request))
        .handle(getUser.operationId, (request) => getUser.handler(request))
    )
  )
)
```

`src/main.ts` is the listener below, with `import { ApiLive } from "./api.ts"` instead of `./routes.gen.ts`.

## File router

A `route.ts` file declares endpoints. `return-generate` is the only discovery: it reads a routes directory and writes one `HttpApi`. The directory is the URL. `Route` still does not take a path. The generator passes that URL to `HttpApiEndpoint`. When the directory has no `layer.ts`, the generated `ApiLive` uses one root scope.

## Rules

**Folders define URLs.** `src/routes/users/route.ts` is `/users`. `src/routes/users/[id]/route.ts` is `/users/:id`.

**Exports define methods.** Name the export `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`, and build it with the matching `Route` function.

**Schemas define types.** The options object takes Effect schemas: `params`, `query`, `headers`, `payload`, `success`, and `error`.

**Handlers return Effects.** The third argument returns an `Effect`.

## A minimal app

Four files. `src/users.ts` holds the records. `src/routes/users/route.ts` is `GET /users`. `src/routes/users/[id]/route.ts` is `GET /users/:id`. `src/main.ts` listens on `127.0.0.1:3000`.

```json
{
  "type": "module",
  "engines": { "node": ">=26 <27" },
  "scripts": {
    "generate": "return-generate --routes src/routes --out src/routes.gen.ts",
    "start": "node src/main.ts"
  },
  "dependencies": {
    "effect": "4.1.0",
    "@chr33s/return": "file:.."
  }
}
```

`file:..` is how a package next to this checkout imports it by name. Node 26 runs the TypeScript. TypeScript 7 typechecks it. `spec/` in this repo is that package, with `generate`, `dev`, `start`, and `test`.

```ts
// src/users.ts
import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String
}) {}

export const UserNotFoundResponse = UserNotFound.pipe(HttpApiSchema.status(404))

const users = [{ id: "1", name: "Ada" }]

export const listUsers = () => Effect.succeed(users)

export const getUser = (id: string) => {
  const user = users.find(item => item.id === id)
  if (user === undefined) return Effect.fail(new UserNotFound({ id }))
  return Effect.succeed(user)
}
```

```ts
// src/routes/users/route.ts
import { Route } from "@chr33s/return"
import { Schema } from "effect"
import { listUsers, User } from "../../users.ts"

export const GET = Route.get(
  "listUsers",
  { success: Schema.Array(User) },
  () => listUsers()
)
```

```ts
// src/routes/users/[id]/route.ts
import { Route } from "@chr33s/return"
import { Schema } from "effect"
import { getUser, User, UserNotFoundResponse } from "../../../users.ts"

export const GET = Route.get(
  "getUser",
  {
    params: { id: Schema.String },
    success: User,
    error: UserNotFoundResponse
  },
  ({ params }) => getUser(params.id)
)
```

```ts
// src/main.ts
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { listen, observeBuild, routerConfig } from "@chr33s/return"
import { ApiLive } from "./routes.gen.ts"

const watched = observeBuild(ApiLive.pipe(Layer.provide(HttpServer.layerServices)))
const web = HttpRouter.toWebHandler(watched.layer, { disableLogger: true, routerConfig })

try {
  await watched.ready
} catch (error) {
  console.error(error)
  await web.dispose()
  process.exit(1)
}

const server = listen(web.handler)

const shutdown = async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  await web.dispose()
  process.exit(0)
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())
```

`npm run generate` writes `src/routes.gen.ts`. `npm start` serves it. `GET /users` returns the list. `GET /users/1` returns Ada. `GET /users/2` returns the declared 404.

## Vite

`@chr33s/return/vite` puts this API and a Vite SPA on one origin. Vite 8.3 or later, before 9, is an optional peer dependency.

```ts
import { returnVite, listen } from "@chr33s/return/vite"
import { Layer } from "effect"
import { HttpServer } from "effect/http"
import { ApiLive } from "./api.ts"

export default {
  plugins: [
    returnVite({
      layer: ApiLive.pipe(Layer.provide(HttpServer.layerServices))
    })
  ]
}
```

`layer` is the hand-written `ApiLive` after platform services, the same value `main` passes to `HttpRouter.toWebHandler`. The file router passes `routesDir` instead, and that path is the one that runs `return-generate`. `createLayer` returns the layer `toWebHandler` receives, so wrap `makeApiLive()` with those platform services the same way `main` wraps `ApiLive`:

```ts
import { Layer } from "effect"
import { HttpServer } from "effect/http"

returnVite({
  routesDir: "src/routes",
  outFile: "src/routes.gen.ts",
  createLayer: (mod) =>
    (mod.makeApiLive() as Layer.Layer<never, never, never>).pipe(
      Layer.provide(HttpServer.layerServices)
    )
})
```

`returnVite` answers `/api` during dev and preview and strips that prefix. The API receives `/users`. `vite build` remains a static client build. `listen` serves `dist` and falls back to `index.html` for a client route.
