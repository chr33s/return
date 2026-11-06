import { readFile, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { nodeRequestToWeb, writeWebResponse } from "../router/listen.ts"
import { matchesPrefix, stripPrefix } from "./prefix.ts"

export type Next = (error?: unknown) => void

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
}

const insideDist = (dist: string, pathname: string) => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const root = path.resolve(dist)
  const target = path.resolve(root, decoded.replace(/^\/+/, ""))
  if (target !== root && !target.startsWith(root + path.sep)) return undefined
  return target
}

const fileToServe = async (dist: string, pathname: string) => {
  const target = insideDist(dist, pathname)
  if (target === undefined) return undefined
  try {
    const info = await stat(target)
    if (info.isFile()) return target
    if (info.isDirectory()) {
      const index = path.join(target, "index.html")
      const indexInfo = await stat(index)
      if (indexInfo.isFile()) return index
    }
  } catch {
    return undefined
  }
  return undefined
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

const serveStatic = async (req: IncomingMessage, res: ServerResponse, dist: string) => {
  const host = req.headers.host ?? "127.0.0.1"
  const url = new URL(req.url ?? "/", `http://${host}`)
  const method = req.method ?? "GET"
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 404
    res.end()
    return
  }
  const file = await fileToServe(dist, url.pathname)
  if (file !== undefined) {
    await sendFile(res, file, method)
    return
  }
  const clientRoute = path.posix.extname(url.pathname) === ""
  if (clientRoute) {
    const index = path.join(path.resolve(dist), "index.html")
    try {
      const info = await stat(index)
      if (info.isFile()) {
        await sendFile(res, index, method)
        return
      }
    } catch {
      // missing index.html
    }
  }
  res.statusCode = 404
  res.end()
}

export interface DispatchOptions {
  readonly prefix: string
  readonly handler: (request: Request) => Promise<Response>
  /** When set, a non-API request is served from this directory instead of calling `next`. */
  readonly dist?: string
}

/**
 * Prefix requests are answered here, including empty 404s.
 * Anything else goes to Vite (`next`) or to `dist`.
 */
export const dispatch = async (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next | undefined,
  options: DispatchOptions
) => {
  const host = req.headers.host ?? "127.0.0.1"
  const url = new URL(req.url ?? "/", `http://${host}`)
  if (!matchesPrefix(url.pathname, options.prefix)) {
    if (next !== undefined) {
      next()
      return
    }
    if (options.dist !== undefined) {
      await serveStatic(req, res, options.dist)
      return
    }
    res.statusCode = 404
    res.end()
    return
  }
  const stripped = new URL(url.href)
  stripped.pathname = stripPrefix(url.pathname, options.prefix)
  try {
    const request = await nodeRequestToWeb(req, stripped)
    const response = await options.handler(request)
    await writeWebResponse(res, response)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  }
}
