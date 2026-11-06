import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

export const nodeRequestToWeb = async (req: IncomingMessage, requestUrl?: URL): Promise<Request> => {
  const host = req.headers.host ?? "127.0.0.1:3000"
  const url = requestUrl ?? new URL(req.url ?? "/", `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  const method = req.method ?? "GET"
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers })
  const body = Readable.toWeb(Readable.from(req)) as ReadableStream<Uint8Array>
  return new Request(url, { method, headers, body, duplex: "half" } as RequestInit)
}

export const writeWebResponse = async (res: ServerResponse, response: Response, method?: string) => {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.appendHeader(key, value)
  })
  if (method === "HEAD" || response.body === null) {
    await response.body?.cancel().catch(() => {})
    res.end()
    return
  }
  const stream = Readable.fromWeb(response.body as NodeReadableStream)
  const stop = () => {
    if (!res.writableFinished) stream.destroy()
  }
  res.once("close", stop)
  try {
    await pipeline(stream, res)
  } finally {
    res.off("close", stop)
  }
}

export const listen = (
  handler: (request: Request) => Promise<Response>,
  host = "127.0.0.1",
  port = 3000
) => {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await nodeRequestToWeb(req)
        const response = await handler(request)
        await writeWebResponse(res, response, req.method)
      } catch (error) {
        console.error(error)
        if (res.writableEnded) return
        if (!res.headersSent) res.statusCode = 500
        res.end()
      }
    })()
  })
  server.listen(port, host)
  return server
}
