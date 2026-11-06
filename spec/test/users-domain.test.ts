import { Effect } from "effect"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { UserNotFound, Users, createUsers, getUserById } from "../src/routes/users/domain.ts"

describe("users domain", () => {
  it("returns a seeded user", async () => {
    const user = await Effect.runPromise(
      getUserById("1").pipe(Effect.provideService(Users, createUsers()))
    )
    assert.deepEqual(user, { id: "1", name: "Ada" })
  })

  it("fails with UserNotFound", async () => {
    const error = await Effect.runPromise(
      Effect.flip(getUserById("missing").pipe(Effect.provideService(Users, createUsers())))
    )
    assert.ok(error instanceof UserNotFound)
    assert.equal(error.id, "missing")
  })
})
