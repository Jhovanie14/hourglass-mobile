import { afterEach, describe, expect, it } from "vitest"
import { getJadesConfig, isPushConfigured } from "./config"

const KEYS = ["JADES_WEBHOOK_URL", "JADES_WEBHOOK_SECRET", "JADES_API_TOKEN"] as const

afterEach(() => KEYS.forEach((k) => delete process.env[k]))

describe("getJadesConfig", () => {
  it("reads the three env vars", () => {
    process.env.JADES_WEBHOOK_URL = "https://jades.example/hook"
    process.env.JADES_WEBHOOK_SECRET = "sec"
    process.env.JADES_API_TOKEN = "tok"
    expect(getJadesConfig()).toEqual({
      webhookUrl: "https://jades.example/hook",
      webhookSecret: "sec",
      apiToken: "tok",
    })
  })

  it("isPushConfigured is true only when url AND secret present", () => {
    expect(isPushConfigured({ webhookUrl: "u", webhookSecret: "s" })).toBe(true)
    expect(isPushConfigured({ webhookUrl: "u" })).toBe(false)
    expect(isPushConfigured({})).toBe(false)
  })
})
