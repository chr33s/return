# @chr33s/return

`@chr33s/return` is a file router for Effect 4.1. A `route.ts` file declares endpoints. `return-generate` reads a routes directory and writes one `HttpApi`.

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

`@chr33s/return/vite` puts this router and a Vite SPA on one origin. Vite 8.3 or later, before 9, is an optional peer dependency.

```ts
import { returnVite, listen } from "@chr33s/return/vite"
```

`returnVite` answers `/api` during dev and preview and strips that prefix. The router receives `/users`. `vite build` remains a static client build. `listen` serves `dist` and falls back to `index.html` for a client route.
