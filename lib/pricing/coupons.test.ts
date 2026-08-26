import { describe, expect, it, vi } from "vitest"
import {
  type Coupon,
  MAX_SPOKEN_COUPONS,
  couponsText,
  fetchCouponsText,
  selectSpeakable,
} from "./coupons"

const NOW = new Date("2026-08-26T18:00:00Z")

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  code: "SUMMER",
  name: "Summer deal",
  type: "percentage",
  value: 20,
  ...over,
})

describe("selectSpeakable", () => {
  it("drops a coupon that has not started", () => {
    const future = coupon({ starts_at: "2026-09-01T00:00:00Z" })
    expect(selectSpeakable([future], NOW)).toEqual([])
  })

  it("drops a coupon that has expired", () => {
    const past = coupon({ expires_at: "2026-08-01T00:00:00Z" })
    expect(selectSpeakable([past], NOW)).toEqual([])
  })

  it("treats the expiry instant as already expired", () => {
    const exactly = coupon({ expires_at: NOW.toISOString() })
    expect(selectSpeakable([exactly], NOW)).toEqual([])
  })

  it("keeps a coupon with no dates at all", () => {
    expect(selectSpeakable([coupon()], NOW)).toHaveLength(1)
  })

  it("drops a coupon with no code, which cannot be redeemed", () => {
    expect(selectSpeakable([coupon({ code: "  " })], NOW)).toEqual([])
  })
})

describe("couponsText", () => {
  it("says nothing when there are no coupons", () => {
    expect(couponsText([], NOW)).toBe("")
  })

  it("speaks a percentage deal with its code", () => {
    expect(couponsText([coupon()], NOW)).toContain("- 20% off with code SUMMER.")
  })

  it("speaks a fixed-amount deal in dollars", () => {
    const text = couponsText([coupon({ type: "fixed", value: 5 })], NOW)
    expect(text).toContain("- $5.00 off with code SUMMER.")
  })

  it("speaks a free-item deal by product name", () => {
    const text = couponsText(
      [coupon({ type: "free_item", value: null, free_item_name: "Small Combo" })],
      NOW
    )
    expect(text).toContain("- a free Small Combo with code SUMMER.")
  })

  it("puts the day restriction in the same sentence as the offer", () => {
    // The whole point: a caller who hears the discount and then a separate
    // caveat has already stopped listening and turns up on the wrong day.
    const text = couponsText(
      [coupon({ redeemable_weekdays: ["tuesday", "wednesday"] })],
      NOW
    )
    expect(text).toContain("- 20% off with code SUMMER, but only on Tuesdays and Wednesdays.")
  })

  it("speaks a single restricted day without a conjunction", () => {
    const text = couponsText([coupon({ redeemable_weekdays: ["friday"] })], NOW)
    expect(text).toContain("only on Fridays.")
  })

  it("speaks three or more restricted days as a list", () => {
    const text = couponsText(
      [coupon({ redeemable_weekdays: ["friday", "saturday", "sunday"] })],
      NOW
    )
    expect(text).toContain("only on Fridays, Saturdays and Sundays.")
  })

  it("speaks the expiry date", () => {
    const text = couponsText([coupon({ expires_at: "2026-09-30T12:00:00Z" })], NOW)
    expect(text).toContain("until September 30.")
  })

  it("combines day restriction and expiry in order", () => {
    const text = couponsText(
      [coupon({ redeemable_weekdays: ["tuesday"], expires_at: "2026-09-30T12:00:00Z" })],
      NOW
    )
    expect(text).toContain(
      "- 20% off with code SUMMER, but only on Tuesdays, until September 30."
    )
  })

  it("refuses to speak a coupon it cannot describe precisely", () => {
    // A percentage with no value, or a free item with no product, would come
    // out as "off with code SUMMER". Silence is better.
    expect(couponsText([coupon({ value: null })], NOW)).toBe("")
    expect(couponsText([coupon({ type: "free_item", value: null })], NOW)).toBe("")
  })

  it("caps the list and says so rather than truncating silently", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      coupon({ code: `CODE${i}`, value: i + 1 })
    )
    const text = couponsText(many, NOW)
    const spoken = text.split("\n").filter((line) => line.startsWith("- "))
    expect(spoken).toHaveLength(MAX_SPOKEN_COUPONS)
    expect(text).toContain("There are more deals on the website")
  })

  it("does not claim there are more when everything fitted", () => {
    expect(couponsText([coupon()], NOW)).not.toContain("more deals on the website")
  })
})

describe("fetchCouponsText", () => {
  const url = "https://bucketbaddie.test/api/public-coupons"

  it("stays silent while the flag is off, even with a URL configured", () => {
    const spy = vi.fn()
    return expect(
      fetchCouponsText({ BB_COUPONS_URL: url }, NOW, spy as unknown as typeof fetch)
    ).resolves.toBe("").then(() => {
      expect(spy).not.toHaveBeenCalled()
    })
  })

  it("stays silent when enabled but no URL is set", async () => {
    const spy = vi.fn()
    await expect(
      fetchCouponsText(
        { BB_COUPONS_ENABLED: "true" },
        NOW,
        spy as unknown as typeof fetch
      )
    ).resolves.toBe("")
    expect(spy).not.toHaveBeenCalled()
  })

  it("returns the formatted block on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [coupon()],
    })
    const text = await fetchCouponsText(
      { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
      NOW,
      fetchImpl as unknown as typeof fetch
    )
    expect(text).toContain("20% off with code SUMMER")
  })

  it("unwraps a Laravel-style { data: [...] } envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [coupon()] }),
    })
    const text = await fetchCouponsText(
      { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
      NOW,
      fetchImpl as unknown as typeof fetch
    )
    expect(text).toContain("20% off with code SUMMER")
  })

  it("sends the bearer token when one is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    await fetchCouponsText(
      { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url, BB_COUPONS_TOKEN: "s3cret" },
      NOW,
      fetchImpl as unknown as typeof fetch
    )
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      authorization: "Bearer s3cret",
    })
  })

  it("degrades to silence on a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    await expect(
      fetchCouponsText(
        { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
        NOW,
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBe("")
  })

  it("degrades to silence when the fetch throws or times out", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"))
    await expect(
      fetchCouponsText(
        { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
        NOW,
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBe("")
  })

  it("degrades to silence on a body that is not a list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "nope" }),
    })
    await expect(
      fetchCouponsText(
        { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
        NOW,
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBe("")
  })

  it("never throws, whatever the endpoint does", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("not json")
      },
    })
    await expect(
      fetchCouponsText(
        { BB_COUPONS_ENABLED: "true", BB_COUPONS_URL: url },
        NOW,
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBe("")
  })
})
