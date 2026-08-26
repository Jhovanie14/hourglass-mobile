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
    expect(before).toContain("From 18 September these hours change to:")
    expect(before).toContain("- Monday: closed.")

    const after = hoursText(TLP_HOURS, AFTER)
    expect(after).not.toContain("these hours change to")
    expect(after).toContain("- Monday: closed.")
  })

  it("quotes The Launch Pad's service hours, which are not the self-service bays", () => {
    // The bays are 24/7 and always were; that lives in the pricing block, not
    // here, so this must never claim the site's hours cover them.
    const text = hoursText(TLP_HOURS, BEFORE)
    expect(text).toContain("- Monday: 9:30 AM to 6:30 PM.")
    expect(text).not.toMatch(/24 hours|self-service/i)
  })

  it("leaves Bucket Baddie unaffected — it has one schedule", () => {
    expect(upcomingChange(BUCKET_BADDIE_HOURS, BEFORE)).toBeNull()
    expect(hoursText(BUCKET_BADDIE_HOURS, AFTER)).not.toContain("change to")
  })
})
