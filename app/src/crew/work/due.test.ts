// 到期狀態的純函式（#133）：固定的「今天」計算逾期、3 天內到期、還早與沒有到期日。
import { describe, expect, it } from "vitest";
import { crewToday, dueStatus, isDateOnly, localDate, shownDueStatus, SOON_DAYS } from "./due";

describe("dueStatus", () => {
  const today = "2026-11-20";

  it("早於今天是逾期；今天起 3 天內（含今天與第 3 天）是即將到期；之後是還早", () => {
    expect(SOON_DAYS).toBe(3);
    expect(dueStatus("2026-11-19", today)).toBe("overdue");
    expect(dueStatus("2026-01-01", today)).toBe("overdue");
    expect(dueStatus("2026-11-20", today)).toBe("soon");
    expect(dueStatus("2026-11-23", today)).toBe("soon");
    expect(dueStatus("2026-11-24", today)).toBe("later");
    expect(dueStatus("2027-03-01", today)).toBe("later");
  });

  it("沒有到期日是 none", () => {
    expect(dueStatus(null, today)).toBe("none");
  });

  it("跨月、跨年與閏日照日期計算", () => {
    expect(dueStatus("2026-12-02", "2026-11-29")).toBe("soon");
    expect(dueStatus("2027-01-02", "2026-12-31")).toBe("soon");
    expect(dueStatus("2028-03-01", "2028-02-28")).toBe("soon");
    expect(dueStatus("2028-02-27", "2028-02-29")).toBe("overdue");
  });

  it("格式不對時拋錯", () => {
    expect(() => dueStatus("2026/11/20", today)).toThrow();
    expect(() => dueStatus("2026-11-20", "11-20")).toThrow();
    expect(() => dueStatus(null, "")).toThrow();
  });
});

describe("shownDueStatus", () => {
  it("已通過的交辦不標逾期或即將到期，只顯示日期", () => {
    expect(shownDueStatus("2026-11-01", "2026-11-20", true)).toBe("later");
    expect(shownDueStatus("2026-11-21", "2026-11-20", true)).toBe("later");
    expect(shownDueStatus(null, "2026-11-20", true)).toBe("none");
  });

  it("還沒通過時與 dueStatus 相同", () => {
    for (const due of ["2026-11-01", "2026-11-21", "2026-12-31", null]) {
      expect(shownDueStatus(due, "2026-11-20", false)).toBe(dueStatus(due, "2026-11-20"));
    }
  });
});

describe("isDateOnly", () => {
  it("只接受存在的 YYYY-MM-DD", () => {
    expect(isDateOnly("2026-11-20")).toBe(true);
    expect(isDateOnly("2028-02-29")).toBe(true);
    for (const v of ["2026-02-30", "2026-13-01", "2026-11-20T00:00:00Z", "20261120", "", null, 20261120]) expect(isDateOnly(v), String(v)).toBe(false);
  });
});

describe("crewToday", () => {
  it("demo 有 today 時用它，不看目前的日期", () => {
    expect(crewToday({ today: "2026-11-20" }, new Date(2030, 0, 15))).toBe("2026-11-20");
  });

  it("沒有 today 或沒有 demo 時用目前的日期（本地時間）", () => {
    expect(crewToday({}, new Date(2030, 0, 5, 23, 30))).toBe("2030-01-05");
    expect(crewToday(null, new Date(2030, 11, 31))).toBe("2030-12-31");
    expect(localDate(new Date(2026, 1, 3))).toBe("2026-02-03");
  });
});
