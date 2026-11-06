import { lstat, readFile, realpath, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { nodeRequestToWeb, writeWebResponse } from "../router/listen.ts"
import { claimedByBase, matchesPrefix, normalizeBase, stripPrefix } from "./prefix.ts"
import { parseOriginForm, requestHost, requestScheme, requestUrl } from "./request-target.ts"

export type Next = (error?: unknown) => void

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
}

const end = (res: ServerResponse, status?: number) => {
  if (res.headersSent || res.writableEnded) return
  if (status !== undefined) res.statusCode = status
  res.end()
}

const isInside = (root: string, target: string) =>
  target === root || target.startsWith(root + path.sep)

const insideDist = (dist: string, pathname: string) => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const root = path.resolve(dist)
  const target = path.resolve(root, decoded.replace(/^\/+/, ""))
  if (!isInside(root, target)) return undefined
  return target
}

type Located =
  | { readonly kind: "file", readonly file: string }
  | { readonly kind: "missing" }
  | { readonly kind: "blocked" }

const locate = async (dist: string, pathname: string): Promise<Located> => {
  const lexical = insideDist(dist, pathname)
  if (lexical === undefined) return { kind: "blocked" }
  try {
    await lstat(lexical)
  } catch {
    return { kind: "missing" }
  }
  let root: string
  let real: string
  try {
    root = await realpath(dist)
    real = await realpath(lexical)
  } catch {
    return { kind: "blocked" }
  }
  if (!isInside(root, real)) return { kind: "blocked" }
  const info = await stat(real)
  if (info.isFile()) return { kind: "file", file: real }
  if (!info.isDirectory()) return { kind: "missing" }
  const index = path.join(real, "index.html")
  try {
    const realIndex = await realpath(index)
    if (!isInside(root, realIndex)) return { kind: "blocked" }
    const indexInfo = await stat(realIndex)
    if (!indexInfo.isFile()) return { kind: "missing" }
    return { kind: "file", file: realIndex }
  } catch {
    return { kind: "missing" }
  }
}

const indexFile = async (dist: string) => {
  try {
    const root = await realpath(dist)
    const real = await realpath(path.join(root, "index.html"))
    if (!isInside(root, real)) return undefined
    const info = await stat(real)
    if (!info.isFile()) return undefined
    return real
  } catch {
    return undefined
  }
}

const sendFile = async (res: ServerResponse, file: string, method: string) => {
  const data = await readFile(file)
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader("content-type", types[ext] ?? "application/octet-stream")
  res.setHeader("content-length", data.byteLength)
  if (method === "HEAD") {
    res.end()
    return
  }
  res.end(data)
}

/** A missing `.env` has no extension, but it is not a client route. */
const isClientRoute = (pathname: string) => {
  const name = path.posix.basename(pathname)
  if (name.startsWith(".")) return false
  return path.posix.extname(name) === ""
}

const serveStatic = async (res: ServerResponse, dist: string, pathname: string, method: string) => {
  try {
    if (method !== "GET" && method !== "HEAD") {
      end(res, 404)
      return
    }
    const located = await locate(dist, pathname)
    if (located.kind === "file") {
      await sendFile(res, located.file, method)
      return
    }
    if (located.kind === "missing" && isClientRoute(pathname)) {
      const index = await indexFile(dist)
      if (index !== undefined) {
        await sendFile(res, index, method)
        return
      }
    }
    end(res, 404)
  } catch (error) {
    console.error(error)
    end(res, 500)
  }
}

export interface DispatchOptions {
  readonly prefix: string
  /** Vite `base`. Default `/`. A base of `/api/` is the SPA, not the router. */
  readonly base?: string
  readonly handler: (request: Request) => Promise<Response>
  /** When set, a non-API request is served from this directory instead of calling `next`. */
  readonly dist?: string
}

const forward = async (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next | undefined,
  dist: string | undefined,
  pathname: string
) => {
  if (next !== undefined) {
    next()
    return
  }
  if (dist !== undefined) {
    await serveStatic(res, dist, pathname, req.method ?? "GET")
    return
  }
  end(res, 404)
}

/**
 * Prefix requests are answered here, including empty 404s.
 * Anything else goes to Vite (`next`) or to `dist`.
 * This function always settles, and it ends the response when it does not call `next`.
 */
export const dispatch = async (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next | undefined,
  options: DispatchOptions
) => {
  try {
    const origin = parseOriginForm(req.url)
    const host = requestHost(req)
    if (origin === undefined || host === undefined) {
      end(res, 400)
      return
    }
    const base = normalizeBase(options.base)
    if (claimedByBase(origin.pathname, base) || !matchesPrefix(origin.pathname, options.prefix)) {
      await forward(req, res, next, options.dist, origin.pathname)
      return
    }
    const url = requestUrl(requestScheme(req), host, stripPrefix(origin.pathname, options.prefix), origin.search)
    if (url === undefined) {
      end(res, 400)
      return
    }
    const request = await nodeRequestToWeb(req, url)
    const response = await options.handler(request)
    await writeWebResponse(res, response, req.method)
  } catch (error) {
    console.error(error)
    end(res, 500)
  }
}
