// #153 第 8 點：時間戳一律以展示公司的時區（client/crew/settings.json 的 Asia/Taipei）顯示，與觀看者的時區（TZ）無關；只有日期的欄位不變。
import { afterEach, describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { formatDueDate } from "./ui/components";
import { CREW_TIME_ZONE, formatInZone, isSameDay, resolveTimeZone, shortDate, shortDateTime } from "./time";
import settings from "@client/crew/settings.json";

const ZONES = ["UTC", "Europe/London", "America/Los_Angeles", "Asia/Taipei"];
const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

/** 在每個 TZ 下各算一次，回傳所有結果 */
function acrossZones<T>(run: () => T): T[] {
  return ZONES.map((zone) => {
    process.env.TZ = zone;
    return run();
  });
}

describe("展示公司的時區", () => {
  it("參考情境的設定是 Asia/Taipei", () => {
    expect(settings).toEqual({ timeZone: "Asia/Taipei" });
    expect(CREW_TIME_ZONE).toBe("Asia/Taipei");
  });

  it("不合法的時區拋錯；沒有設定檔時退回 UTC", () => {
    expect(() => resolveTimeZone({ timeZone: "Mars/Olympus" })).toThrow(/unknown timeZone/);
    expect(() => resolveTimeZone({ timeZone: "" })).toThrow();
    expect(() => resolveTimeZone({})).toThrow();
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone({ timeZone: "Asia/Taipei" })).toBe("Asia/Taipei");
  });

  it("同一個時間戳在不同的 TZ 下顯示相同", () => {
    const iso = "2026-11-19T17:30:00Z";
    for (const language of clientConfig.client.languages) {
      const shown = acrossZones(() => [
        shortDate(iso, language),
        shortDateTime(iso, language),
        formatInZone(iso, language, { dateStyle: "medium", timeStyle: "short" }),
      ]);
      for (const s of shown) expect(s, language).toEqual(shown[0]);
    }
    expect(new Set(acrossZones(() => isSameDay(iso, new Date("2026-11-20T15:00:00Z"))))).toEqual(new Set([true]));
  });

  it("跨日的時間戳顯示台北的日期與時刻", () => {
    expect(shortDate("2026-11-19T17:30:00Z", "en")).toBe("11/20");
    expect(shortDateTime("2026-11-19T17:30:00Z", "zh-TW")).toBe("11/20 01:30");
    expect(shortDateTime("not a date", "en")).toBe("not a date");
  });

  it("到期日（只有日期）在各 TZ 下不變，也不跳一天", () => {
    for (const language of clientConfig.client.languages) {
      const shown = acrossZones(() => formatDueDate("2026-11-20", language));
      for (const s of shown) expect(s, language).toBe(new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date("2026-11-20T00:00:00Z")));
    }
  });
});

describe("demo 的時間戳", () => {
  it("在 UTC 與 Asia/Taipei 是同一天（seed 以 slice(0, 10) 寫進文字的日期不受影響）", async () => {
    const { DEMO_RAW } = await import("./demo/load");
    const stamps = JSON.stringify(DEMO_RAW).match(/\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2})/g) ?? [];
    expect(stamps.length).toBeGreaterThan(0);
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    for (const s of stamps) {
      expect(day(new Date(s)), s).toBe(s.slice(0, 10));
      expect(new Date(s).toISOString().slice(0, 10), s).toBe(s.slice(0, 10));
    }
  });
});
