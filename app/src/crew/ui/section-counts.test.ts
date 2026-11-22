// 子導覽的數字與目前子頁的捲動（#103）
import { describe, expect, it } from "vitest";
import type { HomeToday } from "./home-today";
import { scrollDelta, sectionCounts } from "./section-counts";
import type { TodayAssignment, TodaySuggestion } from "./today";

const assignment = (id: string): TodayAssignment => ({
  id,
  title: id,
  sourceKind: "mailbox",
  sourceName: "inbox",
  externalRef: null,
  workTypeId: "support",
  employee: { id: "e1", displayName: "Rowan", roleNote: null },
  checks: [],
  returned: false,
});
const suggestion: TodaySuggestion = { employee: { id: "e1", displayName: "Rowan", roleNote: null }, workTypeId: "support", count: 10 };
const today = (over: Partial<HomeToday>): HomeToday => ({ canReview: true, failing: [], awaiting: [], decide: [], inProgress: [], ...over });

describe("sectionCounts", () => {
  it("工作與驗收是待驗收件數（含有檢查沒通過的），信任是少看建議數", () => {
    expect(sectionCounts(today({ failing: [assignment("a")], awaiting: [assignment("b"), assignment("c")], decide: [suggestion] }))).toEqual({ works: 3, trust: 1 });
  });

  it("進行中的交辦不算", () => {
    expect(sectionCounts(today({ inProgress: [assignment("a")] }))).toEqual({});
  });

  it("0 不顯示", () => {
    expect(sectionCounts(today({ awaiting: [assignment("a")] }))).toEqual({ works: 1 });
    expect(sectionCounts(today({ decide: [suggestion] }))).toEqual({ trust: 1 });
  });

  it("不能驗收的身分沒有數字", () => {
    expect(sectionCounts(today({ canReview: false, awaiting: [assignment("a")], decide: [suggestion] }))).toEqual({});
  });
});

describe("scrollDelta", () => {
  const row = { left: 16, right: 374 };

  it("已經看得見時不捲動", () => {
    expect(scrollDelta(row, { left: 16, right: 100 })).toBe(0);
    expect(scrollDelta(row, { left: 300, right: 374 })).toBe(0);
  });

  it("超出右緣時往右捲到右緣對齊", () => {
    expect(scrollDelta(row, { left: 330, right: 420 })).toBe(46);
  });

  it("超出左緣時往左捲到左緣對齊", () => {
    expect(scrollDelta(row, { left: -40, right: 50 })).toBe(-56);
  });

  it("比按鈕列寬時對齊左緣", () => {
    expect(scrollDelta(row, { left: 100, right: 500 })).toBe(84);
  });
});
