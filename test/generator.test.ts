import { execFile } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { generateProject } from "../src/router/generate.ts"

const exec = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const fixtures = path.join(projectRoot, ".generate-fixtures")

const routeImport = (file: string) => {
  let relative = path.relative(path.dirname(file), path.join(projectRoot, "src/router/Route.ts")).split(path.sep).join("/")
  if (!relative.startsWith(".")) relative = `./${relative}`
  return relative
}

const writeRoute = async (file: string, body: string) => {
  await mkdir(path.dirname(file), { recursive: true })
  const source = body.includes("from \"effect\"") || body.includes("Route.")
    ? `import { Effect, Schema } from "effect"\nimport { Route } from "${routeImport(file)}"\n${body}\n`
    : `${body}\n`
  await writeFile(file, source)
}

const tree = async (name: string) => {
  const root = path.join(fixtures, name)
  await rm(root, { recursive: true, force: true })
  const routesDir = path.join(root, "src/routes")
  const outFile = path.join(root, "src/routes.gen.ts")
  return { root, routesDir, outFile }
}

describe("generator", () => {
  after(async () => {
    await rm(fixtures, { recursive: true, force: true })
  })

  it("fails closed segments, param sets, conflicts, and route exports", async () => {
    const bad = await tree("bad")
    await writeRoute(path.join(bad.routesDir, "[...slug]/route.ts"), `export const GET = Route.get("a", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "[[id]]/route.ts"), `export const GET = Route.get("b", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "[]/route.ts"), `export const GET = Route.get("c", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "user-[id]/route.ts"), `export const GET = Route.get("d", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "[id]-user/route.ts"), `export const GET = Route.get("e", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "[user-id]/route.ts"), `export const GET = Route.get("f", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "[123]/route.ts"), `export const GET = Route.get("g", {}, () => Effect.void)`)
    await writeRoute(
      path.join(bad.routesDir, "users/[id]/route.ts"),
      `export const GET = Route.get("user", { params: { userId: Schema.String } }, ({ params }) => Effect.succeed(params.userId))`
    )
    await writeRoute(
      path.join(bad.routesDir, "posts/[id]/route.ts"),
      `export const GET = Route.get("post", { params: Schema.String }, () => Effect.void)`
    )
    await writeRoute(path.join(bad.routesDir, "dup/a/route.ts"), `export const GET = Route.get("same", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "dup/b/route.ts"), `export const GET = Route.get("same", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "bad-id/route.ts"), `export const GET = Route.get("1bad", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "head/route.ts"), `export const HEAD = 1\nexport const GET = Route.get("headed", {}, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "empty/route.ts"), `export const helper = 1`)
    await writeRoute(path.join(bad.routesDir, "mismatch/route.ts"), `export const GET = Route.post("posted", {}, () => Effect.void)`)
    await mkdir(path.join(bad.routesDir, "no-live/child"), { recursive: true })
    await writeFile(path.join(bad.routesDir, "no-live/layer.ts"), `export const note = 1\n`)
    await writeRoute(path.join(bad.routesDir, "no-live/child/route.ts"), `export const GET = Route.get("child", {}, () => Effect.void)`)
    await mkdir(path.join(bad.routesDir, "fn-live"), { recursive: true })
    await writeFile(path.join(bad.routesDir, "fn-live/layer.ts"), `export const Live = () => ({})\n`)
    await writeRoute(path.join(bad.routesDir, "fn-live/route.ts"), `export const GET = Route.get("fn", {}, () => Effect.void)`)
    await mkdir(path.join(bad.routesDir, "dyn/[id]"), { recursive: true })
    await writeFile(path.join(bad.routesDir, "dyn/[id]/layer.ts"), `import { Layer } from "effect"\nexport const Live = Layer.empty\n`)
    await writeRoute(path.join(bad.routesDir, "dyn/[id]/route.ts"), `export const GET = Route.get("dyn", { params: { id: Schema.String } }, () => Effect.void)`)
    await mkdir(path.join(bad.routesDir, "orphan"), { recursive: true })
    await writeFile(path.join(bad.routesDir, "orphan/layer.ts"), `import { Layer } from "effect"\nexport const Live = Layer.empty\n`)
    await writeRoute(
      path.join(bad.routesDir, "cycle/route.ts"),
      `import { Api } from "../../routes.gen.ts"\nexport const GET = Route.get("cycle", {}, () => Effect.void)\nvoid Api\n`
    )
    await writeRoute(path.join(bad.routesDir, "users/[id]/posts/route.ts"), `export const GET = Route.get("posts", { params: { id: Schema.String } }, () => Effect.void)`)
    await writeRoute(path.join(bad.routesDir, "users/[slug]/comments/route.ts"), `export const GET = Route.get("comments", { params: { slug: Schema.String } }, () => Effect.void)`)

    const result = await generateProject({
      routesDir: bad.routesDir,
      outFile: bad.outFile,
      projectRoot: bad.root
    })
    const joined = result.diagnostics.join("\n")
    for (const segment of ["[...slug]", "[[id]]", "[]", "user-[id]", "[id]-user", "[user-id]", "[123]"]) {
      assert.match(joined, new RegExp(segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    }
    assert.match(joined, /params keys \[userId\] do not match path segments \[id\]/)
    assert.match(joined, /params schema has no literal keys/)
    assert.match(joined, /operation id "same" is already used/)
    assert.match(joined, /operation id "1bad" is not an identifier/)
    assert.match(joined, /HEAD export is not allowed/)
    assert.match(joined, /exports no GET, POST, PUT, PATCH, or DELETE/)
    assert.match(joined, /GET export is not a Route.get descriptor/)
    assert.match(joined, /Live is missing or is not a Layer/)
    assert.match(joined, /cannot be placed in or under a dynamic segment/)
    assert.match(joined, /no descendant route.ts/)
    assert.match(joined, /must not import src\/routes.gen.ts/)
    assert.match(joined, /dynamic segment \[slug\] conflicts with \[id\]/)
    assert.equal(result.wrote, false)
  })

  it("accepts struct params, shared dynamic names, and stable output", async () => {
    const ok = await tree("ok")
    await writeRoute(
      path.join(ok.routesDir, "users/[id]/posts/route.ts"),
      `const Params = Schema.Struct({ id: Schema.NumberFromString })\nexport const GET = Route.get("posts", { params: Params }, ({ params }) => Effect.succeed(params.id))`
    )
    await writeRoute(
      path.join(ok.routesDir, "users/[id]/comments/route.ts"),
      `export const GET = Route.get("comments", { params: { id: Schema.String } }, ({ params }) => Effect.succeed(params.id))`
    )
    await writeRoute(path.join(ok.routesDir, "users/me/route.ts"), `export const GET = Route.get("me", {}, () => Effect.void)`)
    await mkdir(path.join(ok.routesDir, "reexport"), { recursive: true })
    await writeFile(
      path.join(ok.routesDir, "reexport/handlers.ts"),
      `import { Effect } from "effect"\nimport { Route } from "${routeImport(path.join(ok.routesDir, "reexport/handlers.ts"))}"\nexport const GET = Route.get("reexported", {}, () => Effect.void)\n`
    )
    await writeFile(
      path.join(ok.routesDir, "reexport/route.ts"),
      `export { GET } from "./handlers.ts"\n`
    )
    const first = await generateProject({ routesDir: ok.routesDir, outFile: ok.outFile, projectRoot: ok.root })
    assert.deepEqual(first.diagnostics, [])
    assert.equal(first.wrote, true)
    const text = await readFile(ok.outFile, "utf8")
    assert.match(text, /\/\/ Generated by src\/router\/generate.ts\. Do not edit\./)
    assert.match(text, /HttpApiEndpoint.get\([\s\S]*"\/users\/:id\/posts"/)
    assert.match(text, /"\/users\/me"/)
    const second = await generateProject({ routesDir: ok.routesDir, outFile: ok.outFile, projectRoot: ok.root })
    assert.equal(second.changed, false)
    assert.equal(second.wrote, false)
    const checked = await generateProject({
      routesDir: ok.routesDir,
      outFile: ok.outFile,
      projectRoot: ok.root,
      check: true
    })
    assert.deepEqual(checked.diagnostics, [])
    await writeFile(ok.outFile, `${text}\n`)
    const stale = await generateProject({
      routesDir: ok.routesDir,
      outFile: ok.outFile,
      projectRoot: ok.root,
      check: true
    })
    assert.equal(stale.wrote, false)
    assert.match(stale.diagnostics.join("\n"), /generated file is stale/)
    assert.equal(await readFile(ok.outFile, "utf8"), `${text}\n`)
  })

  it("checks the committed routes.gen.ts", async () => {
    const result = await exec(process.execPath, [
      "src/router/generate.ts",
      "--routes",
      "spec/src/routes",
      "--out",
      "spec/src/routes.gen.ts",
      "--check"
    ], {
      cwd: projectRoot
    })
    assert.equal(result.stdout, "unchanged\n")
  })
})
