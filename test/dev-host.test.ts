import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createReloadController, drainMsDefault } from "../src/router/reload.ts"

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

  it("installs the later graph when a second reload starts during the first", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started: () => void = () => {}
    const startedGate = new Promise<void>(resolve => {
      started = resolve
    })
    const disposed: string[] = []
    let loads = 0
    const controller = createReloadController({
      generate: async () => ({ changed: true, diagnostics: [] }),
      load: async () => {
        loads += 1
        const name = `g${loads}`
        if (loads === 1) {
          started()
          await gate
        }
        return {
          handler: async () => new Response(name),
          dispose: async () => {
            disposed.push(name)
          }
        }
      }
    })
    const first = controller.reload()
    await startedGate
    const second = controller.reload()
    release()
    await first
    await second
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g2")
    assert.deepEqual(disposed, ["g1"])
    await controller.dispose()
  })

  it("keeps the installed graph when the follow-up load fails", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started: () => void = () => {}
    const startedGate = new Promise<void>(resolve => {
      started = resolve
    })
    let loads = 0
    const controller = createReloadController({
      generate: async () => ({ changed: true, diagnostics: [] }),
      load: async () => {
        loads += 1
        if (loads === 1) {
          started()
          await gate
          return { handler: async () => new Response("g1"), dispose: async () => {} }
        }
        throw new Error("build failed")
      },
      log: () => {}
    })
    const first = controller.reload()
    await startedGate
    const second = controller.reload()
    release()
    await first
    await second
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g1")
    await controller.dispose()
  })

  it("finalizes a draining graph on shutdown without waiting for the timer", async () => {
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
    await controller.dispose()
    assert.deepEqual(disposed, ["new", "old"])
    release()
    assert.equal(await (await pending).text(), "old")
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

  it("keeps the running graph when generate throws", async () => {
    const logs: string[] = []
    let fail = false
    const controller = createReloadController({
      generate: async () => {
        if (fail) throw new Error("generate blew up")
        return { changed: true, diagnostics: [] }
      },
      load: async () => ({
        handler: async () => new Response("g1"),
        dispose: async () => {}
      }),
      log: (line) => {
        logs.push(line)
      }
    })
    await controller.reload()
    fail = true
    await controller.reload()
    assert.equal(await (await controller.handle(new Request("http://127.0.0.1/"))).text(), "g1")
    assert.match(logs.join("\n"), /generate blew up/)
    await controller.dispose()
  })

  it("discards a graph that finishes loading after shutdown", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let entered: () => void = () => {}
    const enteredGate = new Promise<void>(resolve => {
      entered = resolve
    })
    const disposed: string[] = []
    let loads = 0
    const controller = createReloadController({
      generate: async () => ({ changed: true, diagnostics: [] }),
      load: async () => {
        loads += 1
        const name = `g${loads}`
        if (loads === 2) {
          entered()
          await gate
        }
        return {
          handler: async () => new Response(name),
          dispose: async () => {
            disposed.push(name)
          }
        }
      },
      log: () => {}
    })
    await controller.reload()
    const second = controller.reload()
    await enteredGate
    const closing = controller.dispose()
    release()
    await second
    await closing
    assert.deepEqual(disposed, ["g2", "g1"])
    assert.equal((await controller.handle(new Request("http://127.0.0.1/"))).status, 503)
  })
})
