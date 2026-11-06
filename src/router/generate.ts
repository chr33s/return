import { Layer, Schema } from "effect"
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { isRoute, type AnyRoute, type RouteMethodName } from "./Route.ts"

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const endpointFunction: Record<RouteMethodName, string> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete"
}
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
const dynamicSegment = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/

export interface GenerateOptions {
  readonly routesDir: string
  readonly outFile: string
  readonly projectRoot?: string
  readonly check?: boolean
  readonly importer?: (file: string) => Promise<unknown>
}

export interface GenerateResult {
  readonly changed: boolean
  readonly wrote: boolean
  readonly diagnostics: readonly string[]
}

interface Diagnostic {
  readonly file: string
  readonly message: string
}

interface MethodRoute {
  readonly file: string
  readonly dir: string
  readonly method: RouteMethodName
  readonly operationId: string
  readonly path: string
  readonly alias: string
}

const defaultImporter = (file: string) => import(pathToFileURL(file).href)

const utf8Compare = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))

const posix = (value: string) => value.split(path.sep).join("/")

const displayPath = (file: string, projectRoot: string) => {
  const relative = path.relative(projectRoot, file)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return posix(file)
  return posix(relative)
}

const specifierBetween = (fromFile: string, targetFile: string) => {
  let relative = posix(path.relative(path.dirname(fromFile), targetFile))
  if (!relative.startsWith(".")) relative = `./${relative}`
  return relative
}

const siteKey = (dir: string) => dir === "" ? "." : dir

const parentDir = (dir: string) => {
  if (dir === "") return undefined
  const index = dir.lastIndexOf("/")
  return index === -1 ? "" : dir.slice(0, index)
}

const directoryOf = (routesDir: string, file: string) => {
  const relative = posix(path.relative(routesDir, path.dirname(file)))
  return relative === "" ? "" : relative
}

const invalidSegment = (dir: string) => {
  if (dir === "") return undefined
  for (const segment of dir.split("/")) {
    if ((segment.includes("[") || segment.includes("]")) && !dynamicSegment.test(segment)) return segment
  }
  return undefined
}

const dynamicNames = (dir: string) => {
  if (dir === "") return []
  const names: string[] = []
  for (const segment of dir.split("/")) {
    const match = dynamicSegment.exec(segment)
    if (match?.[1] !== undefined) names.push(match[1])
  }
  return names
}

const routePath = (dir: string) => {
  if (dir === "") return "/"
  const parts = dir.split("/").map(segment => {
    const match = dynamicSegment.exec(segment)
    return match?.[1] !== undefined ? `:${match[1]}` : segment
  })
  return `/${parts.join("/")}`
}

const staticSpecifiers = (source: string) => {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1")
  const specs: string[] = []
  for (const match of stripped.matchAll(/\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g)) {
    if (match[1] !== undefined) specs.push(match[1])
  }
  for (const match of stripped.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    if (match[1] !== undefined) specs.push(match[1])
  }
  return specs
}

const importsGenerated = (file: string, specifier: string, outFile: string) => {
  if (!specifier.startsWith(".")) return false
  const resolved = path.resolve(path.dirname(file), specifier)
  const stripExt = (value: string) => value.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "")
  return stripExt(resolved) === stripExt(outFile)
}

const paramKeys = (params: unknown): { readonly keys: readonly string[] } | { readonly error: string } => {
  if (Schema.isSchema(params)) {
    const ast = params.ast as {
      readonly _tag?: string
      readonly propertySignatures?: ReadonlyArray<{ readonly name: PropertyKey }>
      readonly indexSignatures?: ReadonlyArray<unknown>
    }
    if (ast._tag === "Objects" && (ast.indexSignatures?.length ?? 0) === 0) {
      return { keys: (ast.propertySignatures ?? []).map(signature => String(signature.name)) }
    }
    return { error: "params schema has no literal keys" }
  }
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    const record = params as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.every(key => Schema.isSchema(record[key]))) return { keys }
  }
  return { error: "params schema has no literal keys" }
}

const sameSet = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((key, index) => key === b[index])
}

const ident = (prefix: string, dir: string) => {
  const body = dir === "" ? "root" : dir.replace(/\[/g, "_").replace(/\]/g, "").replace(/[^A-Za-z0-9_]/g, "_")
  return `${prefix}_${body}`
}

interface TrieNode {
  readonly statics: Map<string, TrieNode>
  dynamic?: { readonly name: string, readonly file: string, readonly node: TrieNode }
}

const trieNode = (): TrieNode => ({ statics: new Map() })

async function walk(dir: string, found: string[]) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, found)
    else if (entry.isFile() && (entry.name === "route.ts" || entry.name === "layer.ts")) found.push(full)
  }
}

const render = (
  outFile: string,
  routes: readonly MethodRoute[],
  layers: ReadonlyMap<string, string>
) => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const imports: Array<{ readonly specifier: string, readonly line: string }> = [
    { specifier: "effect", line: `import { Context, Effect, Exit, Layer, Scope } from "effect"` },
    {
      specifier: "effect/http-api",
      line: `import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"`
    },
    {
      specifier: specifierBetween(outFile, path.join(here, "Route.ts")),
      line: `import { applyEndpointMiddleware } from "${specifierBetween(outFile, path.join(here, "Route.ts"))}"`
    },
    {
      specifier: specifierBetween(outFile, path.join(here, "context-tree.ts")),
      line: `import { buildDirectory, selectSite } from "${specifierBetween(outFile, path.join(here, "context-tree.ts"))}"`
    }
  ]
  const aliases = new Map<string, string>()
  const used = new Set<string>()
  const unique = (base: string) => {
    let name = base
    let index = 2
    while (used.has(name)) {
      name = `${base}_${index}`
      index += 1
    }
    used.add(name)
    return name
  }
  const routeFiles = [...new Set(routes.map(route => route.file))].sort(utf8Compare)
  for (const file of routeFiles) {
    const dir = routes.find(route => route.file === file)?.dir ?? ""
    const alias = unique(ident("mod_route", dir))
    aliases.set(file, alias)
    const specifier = specifierBetween(outFile, file)
    imports.push({ specifier, line: `import * as ${alias} from "${specifier}"` })
  }
  const layerAliases = new Map<string, string>()
  for (const [dir, file] of [...layers.entries()].sort((left, right) => utf8Compare(left[0], right[0]))) {
    const alias = unique(ident("mod_layer", dir))
    layerAliases.set(dir, alias)
    const specifier = specifierBetween(outFile, file)
    imports.push({ specifier, line: `import * as ${alias} from "${specifier}"` })
  }
  imports.sort((left, right) => utf8Compare(left.specifier, right.specifier))

  const endpoints = [...routes].sort((left, right) => {
    const byPath = utf8Compare(left.path, right.path)
    if (byPath !== 0) return byPath
    return methods.indexOf(left.method) - methods.indexOf(right.method)
  })
  const endpointArgs = endpoints.map(route => {
    const alias = aliases.get(route.file)
    const fn = endpointFunction[route.method]
    return `applyEndpointMiddleware(\n      HttpApiEndpoint.${fn}(${alias}.${route.method}.operationId, ${JSON.stringify(route.path)}, ${alias}.${route.method}.options),\n      ${alias}.${route.method}.middlewares\n    )`
  })
  const group = endpointArgs.length === 0
    ? `HttpApiGroup.make("routes")`
    : `HttpApiGroup.make("routes").add(\n    ${endpointArgs.join(",\n    ")}\n  )`

  const providerKeys = [...layers.keys()].map(siteKey).sort(utf8Compare)
  const providerFields = providerKeys.map(key => `  readonly ${JSON.stringify(key)}: Layer.Layer<any, any, any>`).join("\n")
  const providerInterface = providerFields.length === 0
    ? `export interface ProviderSites {}\n`
    : `export interface ProviderSites {\n${providerFields}\n}\n`

  const dirs = new Set<string>([""])
  for (const route of routes) {
    const parts = route.dir === "" ? [] : route.dir.split("/")
    let current = ""
    for (const part of parts) {
      current = current === "" ? part : `${current}/${part}`
      dirs.add(current)
    }
  }
  const orderedDirs = [...dirs].sort((left, right) => {
    const leftDepth = left === "" ? 0 : left.split("/").length
    const rightDepth = right === "" ? 0 : right.split("/").length
    if (leftDepth !== rightDepth) return leftDepth - rightDepth
    return utf8Compare(left, right)
  })

  const selections = [...layers.keys()].sort(utf8Compare).map(dir => {
    const alias = layerAliases.get(dir)
    return `  const ${ident("site", dir)} = selectSite(${alias}.Live, providers, ${JSON.stringify(siteKey(dir))})`
  })
  const builds: string[] = []
  for (const dir of orderedDirs) {
    const scope = ident("scope", dir)
    const context = ident("ctx", dir)
    const parent = parentDir(dir)
    const parentScope = parent === undefined ? "graphScope" : ident("scope", parent)
    const parentContext = parent === undefined ? "Context.empty()" : ident("ctx", parent)
    if (layers.has(dir)) {
      builds.push(`        const ${scope} = yield* Scope.fork(${parentScope})`)
      builds.push(`        const ${context} = yield* buildDirectory(${scope}, ${parentContext}, ${ident("site", dir)})`)
    } else {
      builds.push(`        const ${scope} = ${parentScope}`)
      builds.push(`        const ${context} = ${parentContext}`)
    }
  }
  const handles = endpoints.map(route => {
    const alias = aliases.get(route.file)
    const context = ident("ctx", route.dir)
    return `.handle(${JSON.stringify(route.operationId)}, (request) =>\n            ${alias}.${route.method}.handler(request).pipe(Effect.provide(${context}))\n          )`
  })
  const returned = handles.length === 0
    ? `return handlers`
    : `return handlers\n          ${handles.join("\n          ")}`

  return `// Generated by src/router/generate.ts. Do not edit.
${imports.map(item => item.line).join("\n")}

export const Api = HttpApi.make("Api").add(
  ${group}
)

${providerInterface}
export function makeApiLive<const P = {}>(
  options?: {
    readonly providers?: {
      readonly [K in keyof P]: K extends keyof ProviderSites ? P[K] : never
    }
  }
) {
  const providers = options?.providers
${selections.join("\n")}
  const groupLayer = HttpApiBuilder.group(Api, "routes", (handlers) =>
    Effect.gen(function*() {
      const graphScope = yield* Scope.fork(yield* Effect.scope)
      const built = yield* Effect.exit(Effect.gen(function*() {
${builds.join("\n")}
        ${returned}
      }))
      if (Exit.isFailure(built)) {
        yield* Scope.close(graphScope, built)
        return yield* Effect.failCause(built.cause)
      }
      return built.value
    })
  )
  return HttpApiBuilder.layer(Api).pipe(Layer.provide(groupLayer))
}

export const ApiLive = makeApiLive()
`
}

export const generateProject = async (options: GenerateOptions): Promise<GenerateResult> => {
  const projectRoot = options.projectRoot ?? path.dirname(path.dirname(options.routesDir))
  const importer = options.importer ?? defaultImporter
  const files: string[] = []
  await walk(options.routesDir, files)
  files.sort(utf8Compare)
  const diagnostics: Diagnostic[] = []
  const routes: MethodRoute[] = []
  const layers = new Map<string, string>()
  const routeDirs: string[] = []
  const seenIds = new Map<string, string>()
  const trie = trieNode()

  const report = (file: string, message: string) => {
    diagnostics.push({ file, message })
  }

  for (const file of files) {
    if (path.basename(file) !== "route.ts") continue
    routeDirs.push(directoryOf(options.routesDir, file))
  }

  for (const file of files) {
    const dir = directoryOf(options.routesDir, file)
    const source = await readFile(file, "utf8")
    let importsGen = false
    for (const specifier of staticSpecifiers(source)) {
      if (importsGenerated(file, specifier, options.outFile)) {
        report(file, "must not import src/routes.gen.ts")
        importsGen = true
      }
    }
    const segment = invalidSegment(dir)
    if (segment !== undefined) {
      report(file, `directory "${segment}" is not a dynamic segment`)
      continue
    }
    if (importsGen) continue
    if (path.basename(file) === "layer.ts") {
      const underDynamic = dir !== "" && dir.split("/").some(part => dynamicSegment.test(part))
      if (underDynamic) {
        report(file, "layer.ts cannot be placed in or under a dynamic segment")
        continue
      }
      const descendant = routeDirs.some(routeDir =>
        dir === "" || routeDir === dir || routeDir.startsWith(`${dir}/`)
      )
      if (!descendant) {
        report(file, "layer.ts has no descendant route.ts")
        continue
      }
    }
    let loaded: Record<string, unknown>
    try {
      loaded = await importer(file) as Record<string, unknown>
    } catch (error) {
      report(file, `failed to import (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (path.basename(file) === "layer.ts") {
      if (!("Live" in loaded) || !Layer.isLayer(loaded.Live)) {
        report(file, "Live is missing or is not a Layer")
        continue
      }
      layers.set(dir, file)
      continue
    }
    if ("HEAD" in loaded) report(file, "HEAD export is not allowed")
    if ("OPTIONS" in loaded) report(file, "OPTIONS export is not allowed")
    const found: AnyRoute[] = []
    for (const method of methods) {
      if (!(method in loaded)) continue
      const value = loaded[method]
      if (!isRoute(value) || value.method !== method) {
        report(file, `${method} export is not a Route.${endpointFunction[method]} descriptor`)
        continue
      }
      found.push(value)
    }
    const exportedMethods = methods.filter(method => method in loaded)
    if (exportedMethods.length === 0 && !("HEAD" in loaded) && !("OPTIONS" in loaded)) {
      report(file, "route.ts exports no GET, POST, PUT, PATCH, or DELETE")
    }
    const names = dynamicNames(dir)
    for (const route of found) {
      if (!identifier.test(route.operationId)) {
        report(file, `operation id "${route.operationId}" is not an identifier`)
      } else if (seenIds.has(route.operationId)) {
        report(file, `operation id "${route.operationId}" is already used by ${displayPath(seenIds.get(route.operationId) ?? file, projectRoot)}`)
      } else {
        seenIds.set(route.operationId, file)
      }
      if (names.length > 0) {
        const keys = route.options.params === undefined
          ? { error: "params schema has no literal keys" }
          : paramKeys(route.options.params)
        if ("error" in keys) report(file, keys.error)
        else if (!sameSet(keys.keys, names)) {
          report(file, `params keys [${[...keys.keys].sort().join(", ")}] do not match path segments [${[...names].sort().join(", ")}]`)
        }
      }
    }
    if (diagnostics.some(item => item.file === file)) continue
    insertPath(trie, dir, displayPath(file, projectRoot), file, report)
    if (diagnostics.some(item => item.file === file)) continue
    for (const route of found) {
      routes.push({
        file,
        dir,
        method: route.method,
        operationId: route.operationId,
        path: routePath(dir),
        alias: ""
      })
    }
  }

  if (diagnostics.length > 0) {
    return {
      changed: false,
      wrote: false,
      diagnostics: diagnostics.map(item => `${displayPath(item.file, projectRoot)}: ${item.message}`)
    }
  }

  const next = render(options.outFile, routes, layers)
  let current: string | undefined
  try {
    current = await readFile(options.outFile, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const changed = current !== next
  if (!changed) return { changed: false, wrote: false, diagnostics: [] }
  if (options.check) {
    return {
      changed: true,
      wrote: false,
      diagnostics: [`${displayPath(options.outFile, projectRoot)}: generated file is stale`]
    }
  }
  await mkdir(path.dirname(options.outFile), { recursive: true })
  await writeFile(options.outFile, next)
  return { changed: true, wrote: true, diagnostics: [] }
}

const insertPath = (
  root: TrieNode,
  dir: string,
  display: string,
  file: string,
  report: (file: string, message: string) => void
) => {
  const segments = dir === "" ? [] : dir.split("/")
  let node = root
  for (const segment of segments) {
    const match = dynamicSegment.exec(segment)
    if (match?.[1] !== undefined) {
      const name = match[1]
      if (node.dynamic === undefined) {
        node.dynamic = { name, file: display, node: trieNode() }
      } else if (node.dynamic.name !== name) {
        report(
          file,
          `dynamic segment [${name}] conflicts with [${node.dynamic.name}] in ${node.dynamic.file}`
        )
        return
      }
      node = node.dynamic.node
    } else {
      let next = node.statics.get(segment)
      if (next === undefined) {
        next = trieNode()
        node.statics.set(segment, next)
      }
      node = next
    }
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(here, "../..")
  const result = await generateProject({
    routesDir: path.join(projectRoot, "src/routes"),
    outFile: path.join(projectRoot, "src/routes.gen.ts"),
    projectRoot,
    check: process.argv.includes("--check")
  })
  if (result.diagnostics.length > 0) {
    for (const line of result.diagnostics) console.error(line)
    process.exitCode = 1
  } else {
    process.stdout.write(result.wrote ? "wrote\n" : "unchanged\n")
  }
}
