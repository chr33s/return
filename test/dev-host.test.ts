import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createReloadController, drainMsDefault } from "../src/router/reload.js"

describe("dev host reload", () => {
  it("serves 503 until a graph is running and keeps the old graph on failure", async () => {
    const graphs: string[] = []
    let loads = 0
    let mode: "ok" | "diagnostics" | "load-fail" = "ok"
    const controller = createReloadController({
      generate: async () => mode === "diagnostics"
        ? { changed: true, diagnostics: ["src/routes/route.ts: broken"] }
        : { changed: true, diagnostics: [] },
      load: async () => {
        if (mode === "load-fail") throw new Error("build failed")
        loads += 1
        const name = `g${loads}`
        return {
          handler: async () => new Response(name),
          dispose: async () => {
            graphs.push(`dispose:${name}`)
          }
        }
      },
      log: () => {}
    })
    assert.equal((await controller.handle(new Request("http://127.0.0.1/"))).status, 503)
    await controller.reload()
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g1")
    mode = "diagnostics"
    await controller.reload()
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g1")
    mode = "load-fail"
    await controller.reload()
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g1")
    await controller.dispose()
    assert.deepEqual(graphs, ["dispose:g1"])
  })

  it("drains in-flight requests or disposes after the timeout", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const disposed: string[] = []
    let which = "old"
    const timers: Array<() => void> = []
    const controller = createReloadController({
      generate: async () => ({ changed: true, diagnostics: [] }),
      load: async () => {
        const name = which
        return {
          handler: async () => {
            if (name === "old") await gate
            return new Response(name)
          },
          dispose: async () => {
            disposed.push(name)
          }
        }
      },
      schedule: (fn, ms) => {
        assert.equal(ms, drainMsDefault)
        timers.push(fn)
        return { cancel: () => {} }
      }
    })
    await controller.reload()
    const pending = controller.handle(new Request("http://127.0.0.1/"))
    which = "new"
    await controller.reload()
    assert.deepEqual(disposed, [])
    assert.equal(timers.length, 1)
    const next = await controller.handle(new Request("http://127.0.0.1/"))
    assert.equal(await next.text(), "new")
    release()
    assert.equal(await (await pending).text(), "old")
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(disposed, ["old"])
  })

  it("does not reload when generation is unchanged", async () => {
    let loads = 0
    const controller = createReloadController({
      generate: async () => ({ changed: false, diagnostics: [] }),
      load: async () => {
        loads += 1
        return { handler: async () => new Response("ok"), dispose: async () => {} }
      }
    })
    await controller.reload()
    await controller.reload()
    assert.equal(loads, 1)
    await controller.dispose()
  })
})
