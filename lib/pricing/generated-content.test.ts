import { describe, expect, it } from "vitest"
import { bucketBaddiePricingText } from "./bucketbaddie"
import { BUCKET_BADDIE_HOURS, hoursText } from "./hours"
import { pricingText as tlpPricingText } from "@/lib/tlp-pricing"

// Menus and hours are constants in this repo — they only change when someone
// deploys. So there is no reason to ship them over the wire at call time, and
// good reason not to: an assistant whose menu depends on a live webhook has no
// menu at all when that webhook is unreachable, rejected, or being exercised by
// the Telnyx portal's test tool. Baking them into the prompt means the
// receptionist always knows what it sells.
//
// scripts/sync-tlp-assistant.mjs is plain .mjs and cannot import TypeScript, so
// these snapshots are the handover. They are the same text the modules produce,
// written to disk, and this test fails the moment the two drift apart.
//
// TO REGENERATE after changing a menu, price, or the hours:
//
//   npx vitest run lib/pricing/generated-content.test.ts -u
//
// then re-run `npm run sync:assistant`. Forgetting the second step leaves the
// repo right and the live assistant stale, which the sync's own output makes
// obvious by printing the character count.

describe("generated prompt content", () => {
  it("matches the Bucket Baddie menu the sync script bakes in", async () => {
    await expect(bucketBaddiePricingText()).toMatchFileSnapshot(
      "../../scripts/generated/bucket-baddie-pricing.txt"
    )
  })

  it("matches the Bucket Baddie hours the sync script bakes in", async () => {
    await expect(hoursText(BUCKET_BADDIE_HOURS)).toMatchFileSnapshot(
      "../../scripts/generated/bucket-baddie-hours.txt"
    )
  })

  it("matches The Launch Pad pricing the sync script bakes in", async () => {
    await expect(tlpPricingText()).toMatchFileSnapshot(
      "../../scripts/generated/the-launch-pad-pricing.txt"
    )
  })
})
