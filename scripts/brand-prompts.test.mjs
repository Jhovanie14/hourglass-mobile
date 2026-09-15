import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  BRAND_PROMPTS,
  bakeInstructions,
  greetingFor,
  voiceSpeaksMoreThanOneLanguage,
} from "./brand-prompts.mjs"
import { extractInstructions } from "./sync-tlp-assistant.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SHARED = extractInstructions(
  readFileSync(resolve(ROOT, "docs/ai-receptionist-instructions.md"), "utf8")
)

const brand = (label) => BRAND_PROMPTS.find((b) => b.label === label)

describe("BRAND_PROMPTS", () => {
  it("covers both AI brands, labelled exactly as phone_numbers.label", () => {
    expect(BRAND_PROMPTS.map((b) => b.label).sort()).toEqual([
      "Bucket Baddie",
      "The Launch Pad",
    ])
  })

  it("gives each brand its own assistant id env key", () => {
    const keys = BRAND_PROMPTS.map((b) => b.assistantIdEnv)
    expect(new Set(keys).size).toBe(keys.length)
    expect(brand("Bucket Baddie").assistantIdEnv).toBe(
      "TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE"
    )
  })

  it("gives each brand its own webhook slug", () => {
    const slugs = BRAND_PROMPTS.map((b) => b.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const b of BRAND_PROMPTS) expect(b.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps each brand's rules free of the other's trade", () => {
    expect(brand("The Launch Pad").rules).not.toMatch(
      /halal|wings|tenders|glaze|chicken|pickup/i
    )
    expect(brand("Bucket Baddie").rules).not.toMatch(
      /membership|wash|detail|vehicle|tire shine/i
    )
  })
})

describe("bakeInstructions", () => {
  it("substitutes the brand's name and rules into the shared block", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("You are the receptionist for Bucket Baddie.")
    expect(baked).toContain("You are a halal fried chicken spot in Houston.")
  })

  it("leaves no brand placeholder behind", () => {
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b)).not.toMatch(/\{\{\s*brand_/)
    }
  })

  it("never lets one brand's policy or prices reach the other", () => {
    // The bug this whole file exists to prevent: on 2026-08-26 the Bucket
    // Baddie assistant offered car washes, because its identity and policy
    // arrived over a network call that resolved to the wrong brand.
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    const tlp = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(bb).not.toContain(brand("The Launch Pad").rules)
    expect(bb).not.toContain(brand("The Launch Pad").pricing)
    expect(bb).not.toMatch(/membership|tire shine/i)
    expect(tlp).not.toContain(brand("Bucket Baddie").rules)
    expect(tlp).not.toContain(brand("Bucket Baddie").pricing)
    expect(tlp).not.toMatch(/halal|wings|glaze/i)
  })

  it("lets Bucket Baddie name the car wash, but only for directions", () => {
    // They share a lot — the truck is findable only by naming the car wash —
    // so the location note is the single sanctioned cross-brand mention.
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(bb).toContain("same lot as The Launch Pad car wash")

    const outsideLocation = bb.replaceAll(brand("Bucket Baddie").locationNote, "")
    expect(outsideLocation).not.toContain("The Launch Pad")
  })

  it("gives both brands the shared address", () => {
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b), b.label).toContain(
        "10410 South Main Street, Houston, Texas 77025"
      )
    }
  })

  it("bakes in the menu, so the assistant knows it without a webhook", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("Rice Bowl (regular): $11.99")
    expect(baked).toContain("Ghost Pepper")      // a glaze
    expect(baked).toContain("Ranch Drip")        // a dip
    expect(baked).toContain("SAME PRICE, DIFFERENT ITEMS")
    expect(baked).not.toContain("{{ pricing }}")
  })

  it("bakes in the address", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("10410 South Main Street, Houston, Texas 77025")
    expect(baked).toContain("food truck")
  })

  it("bakes The Launch Pad's own prices", () => {
    const baked = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(baked).toContain("Express Complete Detail")
    expect(baked).not.toContain("{{ pricing }}")
  })

  it("does NOT bake hours — they change by the calendar", () => {
    // The Launch Pad drops to Thursday–Sunday on 18 September 2026. A baked
    // copy would still be telling callers we open on Mondays.
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b), b.label).toContain("{{ hours }}")
    }
  })

  it("keeps clock times and day names out of the rules themselves", () => {
    // The rules DO tell the assistant how to shape an hours answer, which is a
    // policy and belongs baked. The times and days it fills that shape with
    // must still come from {{ hours }} — write one into a rules block and it is
    // a frozen copy that goes stale on 18 September and outlives whoever added
    // it. This is the guard the "does NOT bake hours" test above cannot give,
    // since a literal time can sit happily alongside the placeholder.
    for (const b of BRAND_PROMPTS) {
      expect(b.rules, b.label).not.toMatch(/\d{1,2}:\d{2}/)
      expect(b.rules, b.label).not.toMatch(
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
      )
    }
  })

  it("leaves as placeholders only what cannot be known at sync time", () => {
    // Whether we are open this minute, live deals, and agent presence. Baking
    // any of those would freeze them at the moment of the last sync.
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    for (const v of ["{{ hours }}", "{{ open_now }}", "{{ coupons }}"]) {
      expect(baked).toContain(v)
    }
  })

  it("throws rather than shipping a prompt that never names the brand", () => {
    expect(() =>
      bakeInstructions("no placeholders at all", brand("Bucket Baddie"))
    ).toThrow(/never names the brand/)
  })

  it("throws on a placeholder it cannot resolve", () => {
    expect(() =>
      bakeInstructions("{{ brand_name }} and {{ brand_label }}", brand("Bucket Baddie"))
    ).toThrow(/placeholder survived/)
  })

  it("throws if a brand names another outside its location note", () => {
    const poisoned = { ...brand("Bucket Baddie"), rules: "Ask about The Launch Pad." }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(
      /names The Launch Pad outside the location note/
    )
  })

  it("throws if another brand's whole rule block gets in", () => {
    const poisoned = {
      ...brand("Bucket Baddie"),
      rules: brand("The Launch Pad").rules,
    }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(/carries The Launch Pad's rules/)
  })

  it("throws if another brand's price list gets in", () => {
    const poisoned = {
      ...brand("Bucket Baddie"),
      pricing: brand("The Launch Pad").pricing,
    }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(/carries The Launch Pad's prices/)
  })
})

describe("bilingual brands", () => {
  const tlp = () => brand("The Launch Pad")

  it("gives The Launch Pad Spanish and leaves Bucket Baddie English-only", () => {
    // Not a shared-block setting: Bucket Baddie's assistant is still on
    // English-only STT, so a LANGUAGE section there would have it answering in
    // Spanish having transcribed the caller as English gibberish.
    expect(tlp().secondLanguage).toBe("Spanish")
    expect(brand("Bucket Baddie").secondLanguage).toBeUndefined()
  })

  it("bakes a LANGUAGE section only into the bilingual brand", () => {
    expect(bakeInstructions(SHARED, tlp())).toContain("LANGUAGE")
    expect(bakeInstructions(SHARED, brand("Bucket Baddie"))).not.toContain("LANGUAGE")
  })

  it("leaves no placeholder or stray gap for a single-language brand", () => {
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(bb).not.toMatch(/\{\{\s*language_policy\s*\}\}/)
    expect(bb).not.toMatch(/\n{3,}/)
  })

  it("opens in English and does not volunteer Spanish", () => {
    // The client's instruction 2026-09-11: speak Spanish only once the caller
    // does. Announcing it up front is what a phone menu does.
    const baked = bakeInstructions(SHARED, tlp())
    expect(baked).toMatch(/OPENS in\nEnglish every time/)
    expect(baked).toMatch(/Do not mention, offer, or switch to Spanish\nuntil the caller has used it/)
  })

  it("still follows a caller who switches, in either direction", () => {
    const baked = bakeInstructions(SHARED, tlp())
    expect(baked).toMatch(/a few\nwords inside an English one/)
    expect(baked).toMatch(/Switch as often as they do/)
    expect(baked).toMatch(/Never ask a caller to change\nlanguage/)
  })

  it("keeps service names in English inside a Spanish reply", () => {
    // The real risk: "Quick Exterior Wash" translated to something nobody at
    // the counter sells, and no longer distinguishable from Quick Service.
    const baked = bakeInstructions(SHARED, tlp())
    expect(baked).toMatch(/stay in English/)
    expect(baked).toMatch(/exactly as the pricing block writes/)
  })

  it("throws if the shared block loses the placeholder a bilingual brand needs", () => {
    // Silent monolingualism: syncs clean, answers every Spanish caller in
    // English, and nothing else in the pipeline would notice.
    const noPlaceholder = SHARED.replaceAll(/\{\{\s*language_policy\s*\}\}/g, "")
    expect(() => bakeInstructions(noPlaceholder, tlp())).toThrow(/carries no LANGUAGE section/)
  })

  it("does not throw for a single-language brand when the placeholder is gone", () => {
    const noPlaceholder = SHARED.replaceAll(/\{\{\s*language_policy\s*\}\}/g, "")
    expect(() => bakeInstructions(noPlaceholder, brand("Bucket Baddie"))).not.toThrow()
  })
})

describe("the brand's website", () => {
  it("gives every brand one, so none of them is stumped by 'what's your website?'", () => {
    // The Launch Pad had no website in its prompt at all until 2026-09-11 and
    // answered "I don't have that" about its own site.
    for (const b of BRAND_PROMPTS) {
      expect(b.website, `${b.label} has no website`).toBeTruthy()
      expect(b.website, `${b.label}: bare domain only, no scheme or path`).toMatch(
        /^[a-z0-9.-]+\.[a-z]{2,}$/
      )
    }
  })

  it("bakes each brand's own address into its prompt", () => {
    expect(bakeInstructions(SHARED, brand("The Launch Pad"))).toContain("thelaunchpadwash.com")
    expect(bakeInstructions(SHARED, brand("Bucket Baddie"))).toContain("bucketbaddie.com")
  })

  it("never lets one brand's website reach the other", () => {
    expect(bakeInstructions(SHARED, brand("The Launch Pad"))).not.toContain("bucketbaddie.com")
    expect(bakeInstructions(SHARED, brand("Bucket Baddie"))).not.toContain("thelaunchpadwash.com")
  })

  it("throws if a brand is given another's website", () => {
    // This is the check the displayName guard cannot make: "bucketbaddie.com"
    // does not contain "Bucket Baddie", so without its own test it leaks quietly.
    const poisoned = { ...brand("The Launch Pad"), website: "bucketbaddie.com" }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(
      /carries Bucket Baddie's website/
    )
  })

  it("forbids inventing a page on the end of the address", () => {
    // A model that knows the domain will happily offer /booking or /prices,
    // and a caller sent to a 404 is worse off than one given nothing.
    const baked = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(baked).toMatch(/Never add a page or a path to the end of it/)
    expect(baked).not.toMatch(/thelaunchpadwash\.com\//)
  })
})

describe("voiceSpeaksMoreThanOneLanguage", () => {
  it("every bilingual brand declares a voice that can actually speak the second language", () => {
    // The guard that matters. An English-only voice does not error — it reads
    // Spanish with English phonemes, so it sounds like the feature works.
    for (const b of BRAND_PROMPTS.filter((b) => b.secondLanguage)) {
      expect(b.voice, `${b.label} must declare a voice, not inherit the portal's`).toBeTruthy()
      expect(voiceSpeaksMoreThanOneLanguage(b.voice), `${b.label}: ${b.voice}`).toBe(true)
    }
  })

  it("rejects the Kokoro voice The Launch Pad used to be on", () => {
    // Kokoro voices are per-language: af_heart is en-US and there is no setting
    // that makes it speak Spanish.
    expect(voiceSpeaksMoreThanOneLanguage("Telnyx.KokoroTTS.af_heart")).toBe(false)
    expect(voiceSpeaksMoreThanOneLanguage("Telnyx.KokoroTTS.ef_dora")).toBe(false)
  })

  it("rejects a missing voice rather than assuming it is fine", () => {
    expect(voiceSpeaksMoreThanOneLanguage(undefined)).toBe(false)
    expect(voiceSpeaksMoreThanOneLanguage("")).toBe(false)
  })

  it("accepts the Azure multilingual family", () => {
    expect(voiceSpeaksMoreThanOneLanguage("Azure.en-US-AvaMultilingualNeural")).toBe(true)
    expect(voiceSpeaksMoreThanOneLanguage("Azure.es-MX-DaliaMultilingualNeural")).toBe(true)
  })

  it("leaves a single-language brand free to be tuned in the portal", () => {
    // Bucket Baddie deliberately declares no voice: someone can change it by
    // ear without a deploy, and the sync preserves whatever they chose.
    expect(BRAND_PROMPTS.find((b) => b.label === "Bucket Baddie").voice).toBeUndefined()
  })
})

describe("greetingFor", () => {
  it("opens in English even on the bilingual brand", () => {
    // Reversed 2026-09-11 on the client's instruction. The Spanish offer made
    // every English caller — nearly all of them — sit through two seconds of a
    // language they had not asked for, which is what a phone menu does.
    const greeting = greetingFor(brand("The Launch Pad"))
    expect(greeting).toContain("Thanks for calling The Launch Pad")
    expect(greeting).not.toMatch(/español|espanol|puedo atender/i)
  })

  it("still knows how to advertise a second language if a brand asks for one", () => {
    // The capability was not deleted, only switched off for The Launch Pad.
    const optedIn = { ...brand("The Launch Pad"), secondLanguageGreeting: "Hablamos español." }
    expect(greetingFor(optedIn)).toContain("Hablamos español.")
  })

  it("asks a food truck's callers what they want, not how it can help", () => {
    // The closing question is per brand because intent is. Nearly every call to
    // a food truck is an order, and this is what the person at the window says.
    expect(greetingFor(brand("Bucket Baddie"))).toBe(
      "Thanks for calling Bucket Baddie. What can I get you?"
    )
    expect(greetingFor(brand("The Launch Pad"))).toBe(
      "Thanks for calling The Launch Pad. How can I help?"
    )
  })

  it("says no recording notice unless the brand asks for one", () => {
    // Shortened 2026-09-15 on the client's instruction: the notice was eleven
    // of the greeting's 24 words and the part no caller rang up to hear. It
    // lives in §1's HOW TO BE CONSISTENT list now, answered when asked.
    for (const b of BRAND_PROMPTS) {
      expect(greetingFor(b), b.label).not.toMatch(/record/i)
    }
  })

  it("puts the notice back, unhedged, for a brand that opts in", () => {
    // One flag, so a brand whose counsel wants it audible needs no rewrite.
    // "is recorded", never "may be": calls ARE recorded on every answered call,
    // and a hedge only invites a follow-up question.
    const optedIn = { ...brand("Bucket Baddie"), spokenRecordingNotice: true }
    expect(greetingFor(optedIn)).toBe(
      "Thanks for calling Bucket Baddie. This call is recorded. What can I get you?"
    )
  })

  it("stays short enough to talk over — the whole point of the rewrite", () => {
    // The greeting is the one line every caller hears in full. The old one ran
    // 24 words, about eight seconds of dead air before they could speak.
    for (const b of BRAND_PROMPTS) {
      expect(greetingFor(b).split(/\s+/).length, b.label).toBeLessThanOrEqual(12)
    }
  })

  it("refuses to build a greeting for a brand with no opening question", () => {
    // Fail the sync rather than inherit a question that steers callers wrong.
    const { openingQuestion, ...incomplete } = brand("Bucket Baddie")
    expect(() => greetingFor(incomplete)).toThrow(/openingQuestion/)
  })
})
