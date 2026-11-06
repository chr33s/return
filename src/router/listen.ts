import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

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
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return new Request(url, { method, headers, body: Buffer.concat(chunks) })
}

export const writeWebResponse = async (res: ServerResponse, response: Response, method?: string) => {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.appendHeader(key, value)
  })
  if (method === "HEAD" || response.body === null) {
    await response.body?.cancel()
    res.end()
    return
  }
  res.end(Buffer.from(await response.arrayBuffer()))
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
        if (!res.headersSent) res.statusCode = 500
        res.end()
      }
    })()
  })
  server.listen(port, host)
  return server
}
