import { mkdir, symlink, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { PassThrough } from "node:stream"
import path from "node:path"
import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { dispatch } from "../src/vite/dispatch.ts"
import { normalizePrefix } from "../src/vite/prefix.ts"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".vite-fixtures")
const prefix = normalizePrefix("/api")

const req = (url: string, method = "GET", extra?: { host?: string, encrypted?: boolean }) => ({
  url,
  method,
  headers: { host: extra?.host ?? "127.0.0.1:3000" },
  socket: { encrypted: extra?.encrypted === true },
  async *[Symbol.asyncIterator]() {}
}) as unknown as IncomingMessage

const res = () => {
  const headers: Array<[string, string]> = []
  const chunks: Buffer[] = []
  const stream = new PassThrough()
  stream.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.from(chunk))
  })
  const end = stream.end.bind(stream)
  const out = Object.assign(stream, {
    statusCode: 0,
    headersSent: false,
    headers,
    setHeader(key: string, value: string | number) {
      headers.push([key.toLowerCase(), String(value)])
    },
    appendHeader(key: string, value: string | readonly string[]) {
      const text = typeof value === "string" ? value : value.join(", ")
      headers.push([key.toLowerCase(), text])
    },
    end(this: { headersSent: boolean }, ...args: Parameters<PassThrough["end"]>) {
      this.headersSent = true
      return end(...args)
    }
  })
  Object.defineProperty(out, "body", {
    get: () => Buffer.concat(chunks).toString()
  })
  return out as PassThrough & ServerResponse & { headers: Array<[string, string]>, body: string }
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

  it("does not treat /apples as the prefix and keeps a trailing slash", async () => {
    let seen = ""
    const apples = res()
    let nexted = 0
    let handled = 0
    await dispatch(req("/apples"), apples, () => {
      nexted += 1
    }, {
      prefix,
      handler: async () => {
        handled += 1
        return new Response("no")
      }
    })
    assert.equal(handled, 0)
    assert.equal(nexted, 1)

    const slash = res()
    await dispatch(req("/api/users/"), slash, () => {
      throw new Error("trailing slash fell through")
    }, {
      prefix,
      handler: async (request) => {
        seen = new URL(request.url).pathname
        return new Response(null, { status: 204 })
      }
    })
    assert.equal(seen, "/users/")
    assert.equal(slash.statusCode, 204)
  })

  it("rejects scheme-relative and absolute-form targets and a bad host", async () => {
    for (const target of ["//api", "//api/users", "//evil.com/api/secret", "http://evil.com/api/users"]) {
      const response = res()
      let nexted = 0
      let handled = 0
      await dispatch(req(target), response, () => {
        nexted += 1
      }, {
        prefix,
        handler: async () => {
          handled += 1
          return new Response("no")
        }
      })
      assert.equal(handled, 0, target)
      assert.equal(nexted, 0, target)
      assert.equal(response.statusCode, 400, target)
      assert.equal(response.writableEnded, true, target)
    }

    const ipv6 = res()
    let handled = 0
    await dispatch(req("/api/users", "GET", { host: "::1" }), ipv6, () => {
      throw new Error("bad host fell through")
    }, {
      prefix,
      handler: async () => {
        handled += 1
        return new Response("no")
      }
    })
    assert.equal(handled, 0)
    assert.equal(ipv6.statusCode, 400)
    assert.equal(ipv6.writableEnded, true)
  })

  it("uses the socket scheme and writes HEAD with no body", async () => {
    let seen = ""
    const tls = res()
    await dispatch(req("/api/users", "GET", { encrypted: true }), tls, undefined, {
      prefix,
      handler: async (request) => {
        seen = request.url
        return new Response("ok")
      }
    })
    assert.equal(new URL(seen).protocol, "https:")
    assert.equal(tls.body, "ok")

    const head = res()
    let method = ""
    await dispatch(req("/api/users", "HEAD"), head, () => {
      throw new Error("HEAD fell through")
    }, {
      prefix,
      handler: async (request) => {
        method = request.method
        return new Response("secret")
      }
    })
    assert.equal(method, "HEAD")
    assert.equal(head.statusCode, 200)
    assert.equal(head.body, "")
  })

  it("leaves a Vite base of /api/ to the SPA and still matches fetch(/api)", async () => {
    let seen = ""
    const exact = res()
    await dispatch(req("/api"), exact, () => {
      throw new Error("fetch(/api) fell through")
    }, {
      prefix,
      base: "/api/",
      handler: async (request) => {
        seen = new URL(request.url).pathname
        return new Response("api")
      }
    })
    assert.equal(seen, "/")
    assert.equal(exact.body, "api")

    for (const target of ["/api/", "/api/index.html", "/api/users"]) {
      const spa = res()
      let nexted = 0
      let handled = 0
      await dispatch(req(target), spa, () => {
        nexted += 1
      }, {
        prefix,
        base: "/api/",
        handler: async () => {
          handled += 1
          return new Response("no")
        }
      })
      assert.equal(handled, 0, target)
      assert.equal(nexted, 1, target)
    }
  })

  it("does not serve a symlink outside dist or a missing dotfile", async () => {
    const dist = path.join(root, "dist")
    const outside = path.join(root, "secret.txt")
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, "index.html"), "<p>spa</p>")
    await writeFile(path.join(dist, "ok.txt"), "fine")
    await writeFile(path.join(dist, "app.wasm"), "wasm")
    await writeFile(outside, "secret")
    await symlink(outside, path.join(dist, "leak.txt"))
    await symlink(outside, path.join(dist, "leak"))

    const file = res()
    await dispatch(req("/ok.txt"), file, undefined, {
      prefix,
      dist,
      handler: async () => new Response("no")
    })
    assert.equal(file.statusCode, 200)
    assert.equal(file.body, "fine")

    const wasm = res()
    await dispatch(req("/app.wasm"), wasm, undefined, {
      prefix,
      dist,
      handler: async () => new Response("no")
    })
    assert.equal(wasm.statusCode, 200)
    assert.equal(wasm.headers.find(([key]) => key === "content-type")?.[1], "application/wasm")

    for (const target of ["/leak.txt", "/leak", "/.env"]) {
      const blocked = res()
      let handled = 0
      await dispatch(req(target), blocked, undefined, {
        prefix,
        dist,
        handler: async () => {
          handled += 1
          return new Response("no")
        }
      })
      assert.equal(handled, 0, target)
      assert.equal(blocked.statusCode, 404, target)
      assert.equal(blocked.body, "", target)
      assert.equal(blocked.writableEnded, true, target)
    }
  })

  it("strips the vite base before reading dist and leaves it for Vite", async () => {
    const dist = path.join(root, "basedist")
    await mkdir(path.join(dist, "assets"), { recursive: true })
    await writeFile(path.join(dist, "assets", "main.js"), "js")
    const file = res()
    await dispatch(req("/app/assets/main.js"), file, undefined, {
      prefix,
      base: "/app/",
      dist,
      handler: async () => new Response("no")
    })
    assert.equal(file.statusCode, 200)
    assert.equal(file.body, "js")

    const spa = res()
    let nexted = 0
    await dispatch(req("/app/assets/main.js"), spa, () => {
      nexted += 1
    }, {
      prefix,
      base: "/app/",
      dist,
      handler: async () => new Response("no")
    })
    assert.equal(nexted, 1)
    assert.equal(spa.statusCode, 0)
    assert.equal(spa.body, "")
  })
})

describe("vite host shutdown", () => {
  it("logs a thrown generate from the watcher and does not reject", async () => {
    const dir = path.join(root, "watch")
    const routesDir = path.join(dir, "routes")
    const outFile = path.join(dir, "out")
    await mkdir(routesDir, { recursive: true })
    await mkdir(outFile)
    const rejections: unknown[] = []
    const onReject = (error: unknown) => {
      rejections.push(error)
    }
    process.on("unhandledRejection", onReject)
    const logs: string[] = []
    let sawWatch: () => void = () => {}
    const watched = new Promise<void>(resolve => {
      sawWatch = resolve
    })
    const { createReturnHost } = await import("../src/vite/host.ts")
    const host = createReturnHost({
      routesDir,
      outFile,
      projectRoot: dir,
      createLayer: () => ({}),
      log: (line) => {
        logs.push(line)
        if (logs.length >= 2) sawWatch()
      }
    }, true)
    try {
      await host.ready()
      assert.equal(logs.length, 1)
      await writeFile(path.join(routesDir, "note.txt"), "x")
      await watched
      assert.equal(rejections.length, 0)
      await host.close()
      assert.equal(rejections.length, 0)
    } finally {
      process.off("unhandledRejection", onReject)
      await host.close()
      const { rm } = await import("node:fs/promises")
      await rm(dir, { recursive: true, force: true })
    }
  })
})
