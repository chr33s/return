import { Layer } from "effect"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Database, leftDatabase, rootDatabase, seen } from "../src/routes/tree/services.ts"
import { launch, request } from "./launch.ts"

const substituteDatabase = { id: "substitute", token: {} }

const observation = (at: string) => {
  const found = seen.find(item => item.at === at)
  assert.ok(found, at)
  return found
}

describe("context tree", () => {
  it("shares ancestor services and isolates siblings", async () => {
    seen.length = 0
    const web = launch()
    try {
      for (const path of ["/left", "/right", "/left/nested", "/left/rebuilt"]) {
        const response = await web.handler(request("GET", path))
        assert.equal(response.status, 200)
      }
      const left = observation("left")
      const right = observation("right")
      const nested = observation("nested")
      const rebuilt = observation("rebuilt")

      assert.equal(left.captured, right.captured)
      assert.equal(left.captured.database, rootDatabase)
      assert.equal(right.database, rootDatabase)
      assert.equal(left.database, leftDatabase)
      assert.notEqual(left.database, right.database)
      assert.equal(left.captured.database, right.database)
      assert.notEqual(left.captured.database, left.database)
      assert.equal(left.onlyLeft, undefined)
      assert.equal(right.onlyLeft, undefined)
      assert.equal(nested.onlyLeft?.id, "only-left")
      assert.equal(nested.database, left.database)
      assert.equal(rebuilt.captured.database, left.database)
      assert.notEqual(rebuilt.captured, left.captured)
      assert.equal(left.captured.database, rootDatabase)
    } finally {
      await web.dispose()
    }
  })

  it("replaces one directory and keeps a nested layer", async () => {
    seen.length = 0
    const web = launch({
      providers: {
        left: Layer.succeed(Database, substituteDatabase)
      }
    })
    try {
      for (const path of ["/left", "/left/nested", "/right"]) {
        const response = await web.handler(request("GET", path))
        assert.equal(response.status, 200, path)
      }
      const left = observation("left")
      const nested = observation("nested")
      const right = observation("right")
      assert.equal(left.database, substituteDatabase)
      assert.equal(nested.database, substituteDatabase)
      assert.equal(nested.onlyLeft?.id, "only-left")
      assert.equal(right.database, rootDatabase)
      assert.equal(right.captured.database, rootDatabase)
    } finally {
      await web.dispose()
    }
  })
})
