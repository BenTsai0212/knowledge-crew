// 到期狀態的純函式（#133）：固定的「今天」計算逾期、3 天內到期、還早與沒有到期日；相對期限（#193）。
import { describe, expect, it } from "vitest";
import { crewToday, dueStatus, isDateOnly, localDate, relativeDue, shownRelativeDue, SOON_DAYS } from "./due";

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

describe("relativeDue", () => {
  const today = "2026-11-20";

  it("逾期 1 天、3 天：kind 是 overdue，days 是逾期的天數", () => {
    expect(relativeDue("2026-11-19", today)).toEqual({ kind: "overdue", days: 1 });
    expect(relativeDue("2026-11-17", today)).toEqual({ kind: "overdue", days: 3 });
  });

  it("今天、明天、2 天後、7 天後", () => {
    expect(relativeDue("2026-11-20", today)).toEqual({ kind: "today" });
    expect(relativeDue("2026-11-21", today)).toEqual({ kind: "tomorrow" });
    expect(relativeDue("2026-11-22", today)).toEqual({ kind: "inDays", days: 2 });
    expect(relativeDue("2026-11-27", today)).toEqual({ kind: "inDays", days: 7 });
  });

  it("沒有到期日是 none", () => {
    expect(relativeDue(null, today)).toEqual({ kind: "none" });
  });

  it("跨月、跨年與閏日照日期計算", () => {
    expect(relativeDue("2026-12-01", "2026-11-30")).toEqual({ kind: "tomorrow" });
    expect(relativeDue("2026-12-02", "2026-11-29")).toEqual({ kind: "inDays", days: 3 });
    expect(relativeDue("2026-10-30", "2026-11-02")).toEqual({ kind: "overdue", days: 3 });
    expect(relativeDue("2027-01-01", "2026-12-31")).toEqual({ kind: "tomorrow" });
    expect(relativeDue("2028-03-01", "2028-02-28")).toEqual({ kind: "inDays", days: 2 });
  });

  it("與 dueStatus() 的分界一致：逾期相同、今天起 SOON_DAYS 天內是即將到期", () => {
    for (let d = 15; d <= 30; d += 1) {
      const due = `2026-11-${String(d).padStart(2, "0")}`;
      const rel = relativeDue(due, today);
      const left = rel.kind === "overdue" ? -rel.days : rel.kind === "today" ? 0 : rel.kind === "tomorrow" ? 1 : rel.kind === "inDays" ? rel.days : NaN;
      expect(left, due).toBe(d - 20);
      expect(dueStatus(due, today), due).toBe(left < 0 ? "overdue" : left <= SOON_DAYS ? "soon" : "later");
    }
  });

  it("格式不對時拋錯", () => {
    expect(() => relativeDue("2026/11/20", today)).toThrow();
    expect(() => relativeDue(null, "")).toThrow();
  });
});

describe("shownRelativeDue", () => {
  it("已通過的交辦不顯示相對期限（已完成不標逾期）", () => {
    expect(shownRelativeDue("2026-11-01", "2026-11-20", true)).toEqual({ kind: "none" });
    expect(shownRelativeDue("2026-11-21", "2026-11-20", true)).toEqual({ kind: "none" });
    expect(shownRelativeDue(null, "2026-11-20", true)).toEqual({ kind: "none" });
  });

  it("還沒通過時與 relativeDue 相同", () => {
    for (const due of ["2026-11-01", "2026-11-21", "2026-12-31", null]) {
      expect(shownRelativeDue(due, "2026-11-20", false)).toEqual(relativeDue(due, "2026-11-20"));
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
