import { describe, expect, it } from "vitest"
import {
  BUCKET_BADDIE_HOURS,
  TLP_HOURS,
  scheduleAt,
  upcomingChange,
  hoursText,
  isOpenAt,
  nextOpening,
  spokenTime,
  toMinutes,
} from "./hours"

/** America/Chicago is UTC-5 in August (CDT). 21:00 UTC = 16:00 local, which is
 *  opening time — so these UTC instants sit on the boundaries we care about. */
const AUG = (day: number, utcHour: number, utcMinute = 0) =>
  new Date(Date.UTC(2026, 7, day, utcHour, utcMinute))

describe("toMinutes", () => {
  it("treats 24:00 as the end of the day, not the start", () => {
    expect(toMinutes("00:00")).toBe(0)
    expect(toMinutes("16:00")).toBe(960)
    expect(toMinutes("24:00")).toBe(1440)
  })
})

describe("isOpenAt", () => {
  // 2026-08-25 is a Tuesday. Window is 16:00–22:00 Chicago.
  it("is open from the opening minute", () => {
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(25, 21, 0))).toBe(true) // 16:00 CDT
  })

  it("is closed the minute before opening", () => {
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(25, 20, 59))).toBe(false) // 15:59
  })

  it("is closed at exactly the closing minute", () => {
    // 03:00 UTC on the 26th is 22:00 CDT on the 25th.
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(26, 3, 0))).toBe(false)
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(26, 2, 59))).toBe(true) // 21:59
  })

  it("is closed all day Monday", () => {
    // 2026-08-24 is a Monday. Midday and evening both shut.
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(24, 17, 0))).toBe(false) // 12:00
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(24, 23, 0))).toBe(false) // 18:00
  })

  it("keeps a Friday midnight close from spilling into Saturday", () => {
    // 2026-08-28 is a Friday, closing at 24:00. 04:59 UTC Saturday = 23:59
    // Friday and is open; 05:00 UTC = 00:00 Saturday and is not.
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(29, 4, 59))).toBe(true)
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(29, 5, 0))).toBe(false)
  })

  it("evaluates in the store timezone, not the server's", () => {
    // 21:30 UTC on the Tuesday is 16:30 in Chicago (open) but 22:30 in London.
    // A server running in UTC must still say open.
    expect(isOpenAt(BUCKET_BADDIE_HOURS, AUG(25, 21, 30))).toBe(true)
  })
})

describe("nextOpening", () => {
  it("names today when we have not opened yet", () => {
    // Tuesday 10:00 CDT — opens at 16:00 the same day.
    expect(nextOpening(BUCKET_BADDIE_HOURS, AUG(25, 15, 0))).toEqual({
      weekday: "tuesday",
      opensAt: "16:00",
    })
  })

  it("skips today once we have closed", () => {
    // Tuesday 23:00 CDT, after the 22:00 close.
    expect(nextOpening(BUCKET_BADDIE_HOURS, AUG(26, 4, 0))).toEqual({
      weekday: "wednesday",
      opensAt: "16:00",
    })
  })

  it("skips closed Monday entirely", () => {
    // Sunday 23:00 CDT, after Sunday's 22:00 close. Monday is shut, so Tuesday.
    expect(nextOpening(BUCKET_BADDIE_HOURS, AUG(24, 4, 0))).toEqual({
      weekday: "tuesday",
      opensAt: "16:00",
    })
  })

  it("returns null when every day is closed", () => {
    const shut = {
      timeZone: "America/Chicago",
      schedules: [
        {
          effectiveFrom: null,
          hours: {
            monday: null,
            tuesday: null,
            wednesday: null,
            thursday: null,
            friday: null,
            saturday: null,
            sunday: null,
          },
        },
      ],
    }
    expect(nextOpening(shut, AUG(25, 21, 0))).toBeNull()
  })
})

describe("spokenTime", () => {
  it("speaks times the way a person says them", () => {
    expect(spokenTime("16:00")).toBe("4 PM")
    expect(spokenTime("22:00")).toBe("10 PM")
    expect(spokenTime("09:30")).toBe("9:30 AM")
    expect(spokenTime("12:00")).toBe("noon")
    expect(spokenTime("24:00")).toBe("midnight")
    expect(spokenTime("00:00")).toBe("midnight")
  })

  it("never emits a 24-hour clock reading", () => {
    for (const time of ["13:00", "16:45", "23:15"]) {
      expect(spokenTime(time)).toMatch(/(AM|PM|noon|midnight)$/)
    }
  })
})

describe("hoursText", () => {
  it("lists all seven days Monday first, with Monday closed", () => {
    const text = hoursText()
    expect(text).toContain("- Monday: closed.")
    expect(text).toContain("- Tuesday: 4 PM to 10 PM.")
    expect(text).toContain("- Friday: 4 PM to midnight.")
    expect(text).toContain("- Saturday: 4 PM to midnight.")
    expect(text).toContain("- Sunday: 4 PM to 10 PM.")

    const days = text.split("\n").filter((line) => line.startsWith("- "))
    expect(days).toHaveLength(7)
    expect(days[0]).toContain("Monday")
    expect(days[6]).toContain("Sunday")
  })
})

describe("scheduled hours changes", () => {
  // The Launch Pad drops to Thursday–Sunday on 2026-09-18. Both schedules ship
  // together so the change lands on the day without anyone deploying.
  const chicago = (iso: string) => new Date(iso)
  const BEFORE = chicago("2026-09-17T17:00:00Z") // Thu 17 Sep, 12:00 CDT
  const AFTER = chicago("2026-09-21T17:00:00Z") // Mon 21 Sep, 12:00 CDT

  it("uses the current schedule before the change date", () => {
    expect(scheduleAt(TLP_HOURS, BEFORE).monday).toEqual({ open: "09:30", close: "18:30" })
    // Monday 14 Sep at noon — open under the old schedule.
    expect(isOpenAt(TLP_HOURS, chicago("2026-09-14T17:00:00Z"))).toBe(true)
  })

  it("switches to Thursday–Sunday on the day, with no deploy", () => {
    expect(scheduleAt(TLP_HOURS, AFTER).monday).toBeNull()
    expect(scheduleAt(TLP_HOURS, AFTER).thursday).toEqual({ open: "09:30", close: "18:30" })
    // The same Monday noon, one week later, is now closed.
    expect(isOpenAt(TLP_HOURS, AFTER)).toBe(false)
  })

  it("switches exactly at midnight store time, not UTC", () => {
    // 04:59 UTC on the 18th is still 23:59 on the 17th in Chicago.
    expect(scheduleAt(TLP_HOURS, chicago("2026-09-18T04:59:00Z")).monday).not.toBeNull()
    expect(scheduleAt(TLP_HOURS, chicago("2026-09-18T05:01:00Z")).monday).toBeNull()
  })

  it("announces the change while it is still ahead, and stops afterwards", () => {
    const before = hoursText(TLP_HOURS, BEFORE)
    expect(before).toContain("From 18 September the detailing and service hours change to:")
    expect(before).toContain("- Monday: closed.")

    const after = hoursText(TLP_HOURS, AFTER)
    expect(after).not.toContain("change to")
    expect(after).toContain("- Monday: closed.")
  })

  it("names the schedule it is changing, not just 'these hours'", () => {
    // There is now a 24/7 block sitting between the two schedules, so "these
    // hours change to" would read as if the bays were the thing changing.
    const before = hoursText(TLP_HOURS, BEFORE)
    expect(before).not.toContain("these hours change to")
  })

  it("leaves Bucket Baddie unaffected — it has one schedule", () => {
    expect(upcomingChange(BUCKET_BADDIE_HOURS, BEFORE)).toBeNull()
    expect(hoursText(BUCKET_BADDIE_HOURS, AFTER)).not.toContain("change to")
  })
})

describe("hours that do not cover the whole business", () => {
  const BEFORE = new Date("2026-09-17T17:00:00Z") // Thu 17 Sep, 12:00 CDT
  const AFTER = new Date("2026-09-21T17:00:00Z") // Mon 21 Sep, 12:00 CDT

  // REVERSAL, 2026-09-07. This file used to assert the OPPOSITE — that TLP's
  // hours text must never mention the self-service bays, on the reasoning that
  // 24/7 is a property of the bays and belongs in the brand rules. The rules do
  // still say it, and it was not enough: the hours block read as one set of
  // opening times for the whole site, so the prompt's "if open_now is no, tell
  // them we're closed" branch fired at 2am and the caller never heard that the
  // bays were open. The qualification now travels with the hours it qualifies.
  it("says whose hours these are, so they are not read as the whole site's", () => {
    const text = hoursText(TLP_HOURS, BEFORE)
    expect(text).toContain("Detailing and service hours")
    expect(text).toContain("- Monday: 9:30 AM to 6:30 PM.")
  })

  it("names what stays open regardless of them", () => {
    const text = hoursText(TLP_HOURS, BEFORE)
    expect(text).toContain("Open 24 hours a day, 7 days a week")
    expect(text).toContain("- The self-service bays.")
    expect(text).toContain("- The self-service vacuums.")
  })

  it("puts the 24/7 note between the two schedules, so the change cannot claim it", () => {
    const text = hoursText(TLP_HOURS, BEFORE)
    const always = text.indexOf("Open 24 hours a day")
    const change = text.indexOf("change to:")
    expect(always).toBeGreaterThan(-1)
    expect(change).toBeGreaterThan(always)
  })

  it("still names the bays once the September schedule is in force", () => {
    const text = hoursText(TLP_HOURS, AFTER)
    expect(text).toContain("Open 24 hours a day, 7 days a week")
    expect(text).toContain("- Thursday: 9:30 AM to 6:30 PM.")
    expect(text).toContain("- Monday: closed.")
  })

  it("leaves a brand whose hours do cover everything alone", () => {
    const text = hoursText(BUCKET_BADDIE_HOURS, BEFORE)
    expect(text.startsWith("Opening hours.")).toBe(true)
    expect(text).not.toMatch(/24 hours|always open/i)
  })
})

describe("the whole week in one line", () => {
  const BEFORE = new Date("2026-09-17T17:00:00Z") // Thu 17 Sep, 12:00 CDT
  const AFTER = new Date("2026-09-21T17:00:00Z") // Mon 21 Sep, 12:00 CDT

  // WHY THIS EXISTS. Seven per-day lines answer "are you open Thursday?" and
  // are the wrong shape for "what time do you open?", which is the question
  // people actually ring and ask. On 2026-09-07 the assistant was asked it and
  // said "9:30 to 6:30" with no days at all — it had to collapse the week
  // itself and simply didn't. The collapsed form is now given to it outright.
  it("collapses a week of identical days into one range", () => {
    expect(hoursText(TLP_HOURS, BEFORE)).toContain(
      "The whole week in one line: 9:30 AM to 6:30 PM, Monday to Sunday."
    )
  })

  it("names the open days and the closed run separately", () => {
    const text = hoursText(TLP_HOURS, AFTER)
    expect(text).toContain(
      "The whole week in one line: 9:30 AM to 6:30 PM, Thursday to Sunday. Closed Monday to Wednesday."
    )
  })

  it("keeps the day-by-day list underneath it", () => {
    const text = hoursText(TLP_HOURS, BEFORE)
    expect(text).toContain("Day by day:")
    expect(text).toContain("- Monday: 9:30 AM to 6:30 PM.")
    expect(text.indexOf("The whole week in one line")).toBeLessThan(
      text.indexOf("Day by day:")
    )
  })

  it("handles a week with several different windows", () => {
    // Bucket Baddie is 4-10 Tue-Thu, 4-midnight Fri-Sat, 4-10 Sunday, shut
    // Monday — three runs, and Sunday cannot merge with Tuesday because they
    // are not consecutive.
    const text = hoursText(BUCKET_BADDIE_HOURS, BEFORE)
    expect(text).toContain(
      "The whole week in one line: 4 PM to 10 PM, Tuesday to Thursday; " +
        "4 PM to midnight, Friday and Saturday; 4 PM to 10 PM, Sunday. Closed Monday."
    )
  })

  it("gives the upcoming schedule its own one-liner", () => {
    const text = hoursText(TLP_HOURS, BEFORE)
    const change = text.indexOf("change to:")
    expect(
      text.indexOf("9:30 AM to 6:30 PM, Thursday to Sunday. Closed Monday to Wednesday.")
    ).toBeGreaterThan(change)
  })

  it("tells the assistant to volunteer the change on any hours question", () => {
    // Previously "mention that only if the caller asks about a date on or after
    // it" — too narrow. Someone ringing on the 16th to ask what time we open
    // needs to hear the 18th is different, and will not think to ask.
    const text = hoursText(TLP_HOURS, BEFORE)
    expect(text).toContain("whenever someone asks about our hours")
  })
})
