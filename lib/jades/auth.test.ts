import { describe, expect, it } from "vitest"
import { isValidBearer } from "./auth"

describe("isValidBearer", () => {
  it("accepts a correct bearer token", () => {
    expect(isValidBearer("Bearer tok123", "tok123")).toBe(true)
  })
  it("rejects a wrong token", () => {
    expect(isValidBearer("Bearer nope", "tok123")).toBe(false)
  })
  it("rejects missing header", () => {
    expect(isValidBearer(null, "tok123")).toBe(false)
  })
  it("rejects header without Bearer prefix", () => {
    expect(isValidBearer("tok123", "tok123")).toBe(false)
  })
  it("rejects when configured token is empty", () => {
    expect(isValidBearer("Bearer ", "")).toBe(false)
  })
})
