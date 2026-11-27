// 子導覽的數字（#103；目前子頁的捲動改由共用的 Tabs 處理，測試在 app/src/ui/tabs.test.ts）
import { describe, expect, it } from "vitest";
import type { HomeToday } from "./home-today";
import { sectionCounts } from "./section-counts";
import type { TodayAssignment, TodayGuideline, TodaySuggestion } from "./today";

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
const guideline = (id: string): TodayGuideline => ({ id, employee: suggestion.employee, workTypeId: "support" });
const today = (over: Partial<HomeToday>): HomeToday => ({ canReview: true, failing: [], awaiting: [], decide: [], guidelines: [], inProgress: [], ...over });

describe("sectionCounts", () => {
  it("工作與驗收是待驗收件數（含有檢查沒通過的），信任是看重點的建議數", () => {
    expect(sectionCounts(today({ failing: [assignment("a")], awaiting: [assignment("b"), assignment("c")], decide: [suggestion] }))).toEqual({ works: 3, trust: 1 });
  });

  it("進行中的交辦不算", () => {
    expect(sectionCounts(today({ inProgress: [assignment("a")] }))).toEqual({});
  });

  it("0 不顯示", () => {
    expect(sectionCounts(today({ awaiting: [assignment("a")] }))).toEqual({ works: 1 });
    expect(sectionCounts(today({ decide: [suggestion] }))).toEqual({ trust: 1 });
  });

  it("員工是等確認的守則數（#145），0 不顯示", () => {
    expect(sectionCounts(today({ guidelines: [guideline("g1"), guideline("g2")] }))).toEqual({ employees: 2 });
    expect(sectionCounts(today({ guidelines: [] }))).toEqual({});
  });

  it("不能驗收的身分沒有數字", () => {
    expect(sectionCounts(today({ canReview: false, awaiting: [assignment("a")], decide: [suggestion] }))).toEqual({});
    expect(sectionCounts(today({ canReview: false, guidelines: [guideline("g1")] }))).toEqual({});
  });
});
