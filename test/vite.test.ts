import { mkdir, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { dispatch } from "../src/vite/dispatch.ts"
import { normalizePrefix } from "../src/vite/prefix.ts"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".vite-fixtures")
const prefix = normalizePrefix("/api")

const req = (url: string, method = "GET") => ({
  url,
  method,
  headers: { host: "127.0.0.1:3000" },
  async *[Symbol.asyncIterator]() {}
}) as IncomingMessage

const res = () => {
  const out = {
    statusCode: 0,
    headersSent: false,
    body: "",
    setHeader(_key: string, _value: string | number) {},
    appendHeader(_key: string, _value: string) {},
    end(body?: Uint8Array | string) {
      this.headersSent = true
      if (typeof body === "string") this.body = body
      else if (body !== undefined) this.body = Buffer.from(body).toString()
    }
  }
  return out as typeof out & ServerResponse
}

describe("vite prefix", () => {
  after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(root, { recursive: true, force: true })
  })

  it("strips the prefix and leaves the rest of the URL for the router", async () => {
    let seen = ""
    let method = ""
    const response = res()
    let nexted = 0
    await dispatch(req("/api/users?x=1"), response, () => {
      nexted += 1
    }, {
      prefix,
      handler: async (request) => {
        const url = new URL(request.url)
        seen = `${url.pathname}${url.search}`
        method = request.method
        return new Response("ok")
      }
    })
    assert.equal(seen, "/users?x=1")
    assert.equal(method, "GET")
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, "ok")
    assert.equal(nexted, 0)
  })

  it("keeps an API 404 on the API and lets the SPA handle other paths", async () => {
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "index.html"), "<p>spa</p>")
    const api = res()
    let nexted = 0
    let handled = 0
    await dispatch(req("/api/missing"), api, () => {
      nexted += 1
    }, {
      prefix,
      dist: root,
      handler: async () => {
        handled += 1
        return new Response(null, { status: 404 })
      }
    })
    assert.equal(handled, 1)
    assert.equal(nexted, 0)
    assert.equal(api.statusCode, 404)
    assert.equal(api.body, "")

    const wrong = res()
    nexted = 0
    await dispatch(req("/api/users", "PUT"), wrong, () => {
      nexted += 1
    }, {
      prefix,
      dist: root,
      handler: async (request) => {
        assert.equal(request.method, "PUT")
        assert.equal(new URL(request.url).pathname, "/users")
        return new Response(null, { status: 404 })
      }
    })
    assert.equal(wrong.statusCode, 404)
    assert.equal(wrong.body, "")
    assert.equal(nexted, 0)

    const spa = res()
    handled = 0
    await dispatch(req("/inbox"), spa, undefined, {
      prefix,
      dist: root,
      handler: async () => {
        handled += 1
        return new Response("no")
      }
    })
    assert.equal(handled, 0)
    assert.equal(spa.statusCode, 200)
    assert.equal(spa.body, "<p>spa</p>")

    const vite = res()
    nexted = 0
    await dispatch(req("/@vite/client"), vite, () => {
      nexted += 1
    }, {
      prefix,
      handler: async () => new Response("no")
    })
    assert.equal(nexted, 1)
    assert.equal(vite.statusCode, 0)
  })
})
