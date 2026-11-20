import { describe, expect, it } from "vitest";
import type { AccessFile } from "../../client/types";
import { DEMO } from "./load";
import { demoText, demoTextIndex } from "./texts";
import { demoWorkId, type DemoFile } from "./types";
import { assertDemo, validateDemo } from "./validate";

const t = (zh: string, en: string) => ({ "zh-TW": zh, en });
const label = t("標籤", "Label");
const access: AccessFile = {
  visibilityLevels: [],
  projects: [{ id: "bluewing", label }],
  roles: [
    { id: "staff", label, scope: label, visibility: "internal", projects: ["bluewing"], canUpload: true, canReview: false },
    { id: "manager", label, scope: label, visibility: "internal", projects: ["bluewing"], canUpload: true, canReview: true },
  ],
};
const NOW = new Date("2026-11-01T00:00:00Z");

// 最小的虛構資料：一筆交辦，第 1 輪退回、第 2 輪通過；另一筆等待驗收
function fixture(): DemoFile {
  const work = (round: number, day: number) => ({
    round,
    prNumber: 200 + round,
    submittedAt: `2026-09-0${day}T10:00:00+08:00`,
    summary: t("摘要", "Summary"),
    body: t("本文", "Body"),
    points: [t("重點", "Point")],
    changes: [{ path: "src/a.ts", summary: t("變更", "Change") }],
    checks: [{ name: "ci", status: "pass" as const, checkedAt: `2026-09-0${day}T10:20:00+08:00` }],
  });
  return {
    repos: [{ id: "lantern-notes", fullName: "example-org/lantern-notes", project: "bluewing" }],
    employees: [{ id: "juniper", displayName: "Juniper", roleNote: t("前端與畫面", "Frontend and UI") }],
    workTypes: ["ui"],
    assignments: [
      {
        id: "j01",
        repo: "lantern-notes",
        issueNumber: 101,
        workType: "ui",
        employee: "juniper",
        title: t("空狀態", "Empty state"),
        assignedBy: "manager",
        assignedAt: "2026-09-01T09:00:00+08:00",
        works: [
          { ...work(1, 2), review: { id: "j01-1", verdict: "returned", reason: "wrong", decidedBy: "manager", decidedAt: "2026-09-02T15:00:00+08:00" } },
          { ...work(2, 3), review: { id: "j01-2", verdict: "accepted", decidedBy: "manager", decidedAt: "2026-09-03T15:00:00+08:00" } },
        ],
      },
      {
        id: "j02",
        repo: "lantern-notes",
        issueNumber: 102,
        workType: "ui",
        employee: "juniper",
        title: t("排序", "Sorting"),
        assignedBy: "manager",
        assignedAt: "2026-09-04T09:00:00+08:00",
        works: [{ ...work(1, 5), prNumber: 301 }],
      },
    ],
    levelDecisions: [
      { id: "d01", employee: "juniper", workType: "ui", decision: "relax", basisReview: "j01-2", decidedBy: "manager", decidedAt: "2026-09-03T16:00:00+08:00" },
    ],
    simulations: [{ employee: "juniper", workType: "ui", replies: [{ ...work(1, 6), checks: [{ name: "ci", status: "pending" }] }] }],
  };
}

// 改一處後驗證，回傳錯誤訊息
function errorsAfter(change: (d: DemoFile & Record<string, any>) => void): string[] {
  const demo = structuredClone(fixture()) as DemoFile & Record<string, any>;
  change(demo);
  return validateDemo(demo, access, { now: NOW });
}

describe("validateDemo", () => {
  it("最小的虛構資料通過（含等待驗收的最後一輪與少看的決定）", () => {
    expect(validateDemo(fixture(), access, { now: NOW })).toEqual([]);
    expect(assertDemo(fixture(), access, { now: NOW }).assignments).toHaveLength(2);
  });

  it("不是物件、缺少陣列時回報", () => {
    expect(validateDemo(null, access)).toEqual(["demo: must be an object"]);
    expect(errorsAfter((d: any) => delete d.repos)).toContain("repos: must be an array with at least 1 item(s)");
  });

  it.each([
    ["不存在的員工", (d: any) => (d.assignments[0].employee = "nobody"), "assignments[0].employee: must be an employee"],
    ["不存在的工作類型", (d: any) => (d.levelDecisions[0].workType = "docs"), "levelDecisions[0].workType: must be a work type"],
    ["不存在的 repo", (d: any) => (d.assignments[0].repo = "nowhere"), "assignments[0].repo: must be a repo"],
    ["access.json 沒有的專案", (d: any) => (d.repos[0].project = "nowhere"), "repos[0].project: must be a project"],
    ["不存在的身分", (d: any) => (d.assignments[0].assignedBy = "nobody"), "assignments[0].assignedBy: must be an identity"],
    ["canReview 為 false 的身分", (d: any) => (d.assignments[0].works[0].review.decidedBy = "staff"), "works[0].review.decidedBy: must be an identity"],
    ["模擬交件的員工不存在", (d: any) => (d.simulations[0].employee = "nobody"), "simulations[0].employee: must be an employee"],
  ])("跨檔參照：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["第 1 輪早於交辦", (d: any) => (d.assignments[0].assignedAt = "2026-09-02T11:00:00+08:00"), "works[0].submittedAt: must be after"],
    ["驗收早於檢查", (d: any) => (d.assignments[0].works[0].review.decidedAt = "2026-09-02T10:10:00+08:00"), "works[0].review.decidedAt: must be after"],
    ["檢查早於交件", (d: any) => (d.assignments[0].works[0].checks[0].checkedAt = "2026-09-02T09:00:00+08:00"), "checks[0].checkedAt: must not be before"],
    ["下一輪早於上一輪的驗收", (d: any) => (d.assignments[0].works[1].submittedAt = "2026-09-02T14:00:00+08:00"), "works[1].submittedAt: must be after"],
    ["少看的決定早於依據的驗收", (d: any) => (d.levelDecisions[0].decidedAt = "2026-09-03T14:00:00+08:00"), "levelDecisions[0].decidedAt: must be after the basis review"],
    ["未來的時間", (d: any) => (d.assignments[1].works[0].submittedAt = "2026-12-01T00:00:00Z"), "must be in the past"],
    ["沒有時區的時間", (d: any) => (d.assignments[0].assignedAt = "2026-09-01T09:00:00"), "assignedAt: must be an ISO 8601 time with a time zone"],
  ])("時間順序：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["退回沒有原因", (d: any) => delete d.assignments[0].works[0].review.reason, "works[0].review.reason: must be one of"],
    ["通過卻有原因", (d: any) => (d.assignments[0].works[1].review.reason = "wrong"), "works[1].review.reason: must be omitted"],
    ["通過之後還有下一輪", (d: any) => (d.assignments[0].works[0].review = { ...d.assignments[0].works[0].review, verdict: "accepted", reason: undefined }), "works[0].review.verdict: only the last round"],
    ["最後一輪是退回", (d: any) => (d.assignments[0].works[1].review = { ...d.assignments[0].works[1].review, verdict: "returned", reason: "process" }), "works[1].review.verdict: a returned work must be followed"],
    ["中間的輪次沒有驗收", (d: any) => delete d.assignments[0].works[0].review, "works[0].review: only the last round may be waiting"],
    ["輪次不連續", (d: any) => (d.assignments[0].works[1].round = 3), "works[1].round: must be 2"],
    ["檢查的狀態不在列舉中", (d: any) => (d.assignments[0].works[0].checks[0].status = "ok"), "checks[0].status: must be one of"],
  ])("輪次與驗收：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["依據的驗收屬於別的員工", (d: any) => {
      d.employees.push({ id: "basil", displayName: "Basil", roleNote: t("文件", "Docs") });
      d.levelDecisions[0].employee = "basil";
    }, "levelDecisions[0].basisReview: must belong to the same employee"],
    ["依據的驗收不存在", (d: any) => (d.levelDecisions[0].basisReview = "nope"), "levelDecisions[0].basisReview: must be a review"],
    ["重複的驗收 id", (d: any) => (d.assignments[0].works[1].review.id = "j01-1"), "works[1].review.id: duplicate: j01-1"],
    ["重複的 Issue 編號", (d: any) => (d.assignments[1].issueNumber = 101), "assignments[1].issueNumber: duplicate"],
    ["重複的交辦 id", (d: any) => (d.assignments[1].id = "j01"), "assignments[1].id: duplicate: j01"],
  ])("參照與唯一：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["缺少 en", (d: any) => delete d.assignments[0].title.en, "assignments[0].title.en: must be a non-empty string"],
    ["空白的 zh-TW", (d: any) => (d.employees[0].roleNote["zh-TW"] = " "), "employees[0].roleNote.zh-TW: must be a non-empty string"],
    ["字串含網址", (d: any) => (d.assignments[0].works[0].body.en = "see https://example.com"), "works[0].body.en: must not contain a URL"],
    ["fullName 不是 example-org/", (d: any) => (d.repos[0].fullName = "other-org/lantern-notes"), "repos[0].fullName: must start with example-org/"],
  ])("雙語與虛構資料：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it("languages 選項決定雙語欄位必須有的語言", () => {
    const errors = validateDemo(fixture(), access, { now: NOW, languages: ["zh-TW", "en", "ja"] });
    expect(errors).toContain("employees[0].roleNote.ja: must be a non-empty string");
  });

  it("assertDemo 不通過時拋出列出錯誤的 Error", () => {
    const demo = fixture();
    demo.assignments[0].repo = "nowhere";
    expect(() => assertDemo(demo, access, { now: NOW })).toThrow(/assignments\[0\]\.repo/);
  });
});

describe("demoText", () => {
  const index = demoTextIndex(fixture());
  const w1 = demoWorkId("j01", 1);

  it("依種類、id 與語言回傳虛構資料的文字", () => {
    expect(w1).toBe("j01-w1");
    expect(demoText("title", "j01", "en", index)).toBe("Empty state");
    expect(demoText("roleNote", "juniper", "zh-TW", index)).toBe("前端與畫面");
    expect(demoText("summary", w1, "en", index)).toBe("Summary");
    expect(demoText("body", "j02-w1", "zh-TW", index)).toBe("本文");
    expect(demoText("point", `${w1}/1`, "en", index)).toBe("Point");
    expect(demoText("change", `${w1}/1`, "zh-TW", index)).toBe("變更");
  });

  it("找不到（人新增的資料、沒有的語言或 ordinal）時回傳 null", () => {
    expect(demoText("title", "new-assignment", "en", index)).toBeNull();
    expect(demoText("title", "j01", "ja", index)).toBeNull();
    expect(demoText("point", `${w1}/2`, "en", index)).toBeNull();
  });

  it("預設的索引來自選定客戶的 demo.json（沒有時是空的）", () => {
    const first = DEMO?.assignments[0];
    if (first) expect(demoText("title", first.id, "en")).toBe(first.title.en);
    else expect(demoText("title", "j01", "en")).toBeNull();
  });
});
