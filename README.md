# @chr33s/return

`@chr33s/return` is a file router for Effect 4.1. A `route.ts` file declares endpoints. `return-generate` reads a routes directory and writes one `HttpApi`.

## Rules

**Folders define URLs.** `src/routes/users/route.ts` is `/users`. `src/routes/users/[id]/route.ts` is `/users/:id`.

**Exports define methods.** Name the export `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`, and build it with the matching `Route` function.

**Schemas define types.** The options object takes Effect schemas: `params`, `query`, `headers`, `payload`, `success`, and `error`.

**Handlers return Effects.** The third argument returns an `Effect`.

## A route file

```ts
import { Effect, Schema } from "effect"
import { Route } from "@chr33s/return"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})

export const GET = Route.get(
  "listUsers",
  { success: Schema.Array(User) },
  () => Effect.succeed([])
)
```

Place that file at `src/routes/users/route.ts`.

## The example

`spec/` is a separate package. It depends on this package with `"@chr33s/return": "file:.."` and imports it by name:

```ts
import { Route } from "@chr33s/return"
```

Node 26 runs the TypeScript. Both packages pin TypeScript 7. From `spec/`, the scripts are `generate`, `dev`, `start`, and `test`.

## Vite

`@chr33s/return/vite` puts this router and a Vite SPA on one origin. Vite 7 or 8 is an optional peer dependency.

```ts
import { returnVite, listen } from "@chr33s/return/vite"
```

`returnVite` answers `/api` during dev and preview and strips that prefix. The router receives `/users`. `vite build` remains a static client build. `listen` serves `dist` and falls back to `index.html` for a client route.
