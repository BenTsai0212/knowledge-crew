import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import type { AccessFile } from "../../client/types";
import { parseWorkBody } from "../work/body";
import { DEMO, DEMO_RAW } from "./load";
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
    { id: "lead", label, scope: label, visibility: "internal", projects: ["bluewing"], canUpload: false, canReview: true },
  ],
};
const NOW = new Date("2026-11-01T00:00:00Z");
// 有結構的全文（#65）：等待驗收的交件必須是這種寫法
const SECTIONS = t("@@ src/a.ts [modified]\n加上〔1〕排序〔/1〕", "@@ src/a.ts [modified]\nAdd 〔1〕sorting〔/1〕");

const NOTE = t("先寫結論", "Lead with the conclusion");

// 最小的虛構資料：一筆交辦，第 1 輪退回（有意見）、第 2 輪通過；另一筆等待驗收，依照人提的守則 g01（#142）。
// g02 是員工從同一次退回提出、等確認的守則
function fixture(): DemoFile {
  const work = (round: number, day: number) => ({
    round,
    externalRef: String(200 + round),
    submittedAt: `2026-09-0${day}T10:00:00+08:00`,
    summary: t("摘要", "Summary"),
    body: t("本文", "Body"),
    points: [t("重點", "Point")],
    changes: [{ path: "src/a.ts", summary: t("變更", "Change") }],
    checks: [{ name: "ci", status: "pass" as const, checkedAt: `2026-09-0${day}T10:20:00+08:00` }],
  });
  return {
    sources: [{ id: "lantern-notes", kind: "repo", name: "example-org/lantern-notes", project: "bluewing" }],
    employees: [{ id: "juniper", displayName: "Juniper", roleNote: t("前端與畫面", "Frontend and UI") }],
    workTypes: ["ui"],
    assignments: [
      {
        id: "j01",
        source: "lantern-notes",
        externalRef: "101",
        workType: "ui",
        employee: "juniper",
        title: t("空狀態", "Empty state"),
        assignedBy: "manager",
        assignedAt: "2026-09-01T09:00:00+08:00",
        works: [
          { ...work(1, 2), review: { id: "j01-1", verdict: "returned", reason: "wrong", note: NOTE, decidedBy: "manager", decidedAt: "2026-09-02T15:00:00+08:00" } },
          { ...work(2, 3), review: { id: "j01-2", verdict: "accepted", decidedBy: "manager", decidedAt: "2026-09-03T15:00:00+08:00" } },
        ],
      },
      {
        id: "j02",
        source: "lantern-notes",
        externalRef: "102",
        workType: "ui",
        employee: "juniper",
        title: t("排序", "Sorting"),
        assignedBy: "manager",
        assignedAt: "2026-09-04T09:00:00+08:00",
        works: [{ ...work(1, 5), externalRef: "301", body: SECTIONS, guidelines: ["g01"] }],
      },
    ],
    levelDecisions: [
      { id: "d01", employee: "juniper", workType: "ui", decision: "relax", basisReview: "j01-2", decidedBy: "manager", decidedAt: "2026-09-03T16:00:00+08:00" },
    ],
    guidelines: [
      {
        id: "g01", employee: "juniper", workType: "ui", sourceReview: "j01-1", proposer: "human", proposedAt: "2026-09-02T15:00:00+08:00",
        text: NOTE, decisions: [{ decision: "confirm", decidedBy: "manager", decidedAt: "2026-09-02T15:00:00+08:00" }],
      },
      {
        id: "g02", employee: "juniper", workType: "ui", sourceReview: "j01-1", proposer: "employee", proposedAt: "2026-09-02T16:00:00+08:00",
        text: t("結論放第一段", "Put the conclusion first"), decisions: [],
      },
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
  it("最小的虛構資料通過（含等待驗收的最後一輪與看重點的決定）", () => {
    expect(validateDemo(fixture(), access, { now: NOW })).toEqual([]);
    expect(assertDemo(fixture(), access, { now: NOW }).assignments).toHaveLength(2);
  });

  it("實際的 client/crew/demo.json 通過驗證（access.json 的身分與 client.json 的語言）", () => {
    expect(DEMO_RAW).not.toBeNull();
    expect(validateDemo(DEMO_RAW, clientConfig.access, { languages: clientConfig.client.languages })).toEqual([]);
  });

  it("不是物件、缺少陣列時回報", () => {
    expect(validateDemo(null, access)).toEqual(["demo: must be an object"]);
    expect(errorsAfter((d: any) => delete d.sources)).toContain("sources: must be an array with at least 1 item(s)");
  });

  it.each([
    ["不存在的員工", (d: any) => (d.assignments[0].employee = "nobody"), "assignments[0].employee: must be an employee"],
    ["不存在的工作類型", (d: any) => (d.levelDecisions[0].workType = "docs"), "levelDecisions[0].workType: must be a work type"],
    ["不存在的工作來源", (d: any) => (d.assignments[0].source = "nowhere"), "assignments[0].source: must be a source"],
    ["access.json 沒有的專案", (d: any) => (d.sources[0].project = "nowhere"), "sources[0].project: must be a project"],
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
    ["看重點的決定早於依據的驗收", (d: any) => (d.levelDecisions[0].decidedAt = "2026-09-03T14:00:00+08:00"), "levelDecisions[0].decidedAt: must be after the basis review"],
    ["未來的時間", (d: any) => (d.assignments[1].works[0].submittedAt = "2026-12-01T00:00:00Z"), "must be in the past"],
    ["沒有時區的時間", (d: any) => (d.assignments[0].assignedAt = "2026-09-01T09:00:00"), "assignedAt: must be an ISO 8601 time with a time zone"],
  ])("時間順序：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["退回沒有原因", (d: any) => delete d.assignments[0].works[0].review.reason, "works[0].review.reason: must be one of"],
    ["通過卻有原因", (d: any) => (d.assignments[0].works[1].review.reason = "wrong"), "works[1].review.reason: must be omitted"],
    ["通過之後還有下一輪", (d: any) => (d.assignments[0].works[0].review = { ...d.assignments[0].works[0].review, verdict: "accepted", reason: undefined }), "works[0].review.verdict: only the last round"],
    ["中間的輪次沒有驗收", (d: any) => delete d.assignments[0].works[0].review, "works[0].review: only the last round may be waiting"],
    ["輪次不連續", (d: any) => (d.assignments[0].works[1].round = 3), "works[1].round: must be 2"],
    ["檢查的狀態不在列舉中", (d: any) => (d.assignments[0].works[0].checks[0].status = "ok"), "checks[0].status: must be one of"],
  ])("輪次與驗收：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  // #134：修正中（最後一輪是退回、下一輪還沒交）與待交件（沒有交件）的交辦是合法的資料
  it.each([
    ["最後一輪是退回（修正中）", (d: any) => (d.assignments[0].works[1].review = { ...d.assignments[0].works[1].review, verdict: "returned", reason: "process" })],
    ["沒有交件（待交件）", (d: any) => (d.assignments[1].works = [])],
  ])("輪次與驗收：%s 不是錯誤", (_name, change) => {
    expect(errorsAfter(change)).toEqual([]);
  });

  it("works 不是陣列仍是錯誤", () => {
    expect(errorsAfter((d: any) => delete d.assignments[1].works).join("\n")).toContain("assignments[1].works: must be an array");
  });

  it.each([
    ["依據的驗收屬於別的員工", (d: any) => {
      d.employees.push({ id: "basil", displayName: "Basil", roleNote: t("文件", "Docs") });
      d.levelDecisions[0].employee = "basil";
    }, "levelDecisions[0].basisReview: must belong to the same employee"],
    ["依據的驗收不存在", (d: any) => (d.levelDecisions[0].basisReview = "nope"), "levelDecisions[0].basisReview: must be a review"],
    ["重複的驗收 id", (d: any) => (d.assignments[0].works[1].review.id = "j01-1"), "works[1].review.id: duplicate: j01-1"],
    ["重複的 Issue 編號", (d: any) => (d.assignments[1].externalRef = "101"), "assignments[1].externalRef: duplicate"],
    ["重複的 PR 編號", (d: any) => (d.assignments[1].works[0].externalRef = "201"), "works[0].externalRef: duplicate"],
    ["重複的來源 id", (d: any) => d.sources.push({ ...d.sources[0], name: "example-org/other" }), "sources[1].id: duplicate: lantern-notes"],
    ["重複的交辦 id", (d: any) => (d.assignments[1].id = "j01"), "assignments[1].id: duplicate: j01"],
  ])("參照與唯一：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["缺少 en", (d: any) => delete d.assignments[0].title.en, "assignments[0].title.en: must be a non-empty string"],
    ["空白的 zh-TW", (d: any) => (d.employees[0].roleNote["zh-TW"] = " "), "employees[0].roleNote.zh-TW: must be a non-empty string"],
    ["字串含網址", (d: any) => (d.assignments[0].works[0].body.en = "see https://example.com"), "works[0].body.en: must not contain a URL"],
    ["repo 類的名稱不是 example-org/", (d: any) => (d.sources[0].name = "other-org/lantern-notes"), "sources[0].name: must start with example-org/"],
    ["來源的顯示名稱缺少 en（#60）", (d: any) => (d.sources[0].label = { "zh-TW": "筆記" }), "sources[0].label.en: must be a non-empty string"],
    ["來源的顯示名稱不是物件（#60）", (d: any) => (d.sources[0].label = "Notes"), "sources[0].label: must be an object of languages"],
  ])("雙語與虛構資料：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["類型不在列舉中", (d: any) => (d.sources[0].kind = "chat"), "sources[0].kind: must be one of repo, mailbox, social, knowledge_base"],
    ["repo 類的來源有回流等級（#92）", (d: any) => (d.sources[0].knowledgeVisibility = "internal"), "sources[0].knowledgeVisibility: is only for a knowledge_base source"],
    ["回流等級不在 access.json（#92）", (d: any) => {
      d.sources[0].kind = "knowledge_base";
      d.sources[0].knowledgeVisibility = "secret";
    }, "sources[0].knowledgeVisibility: must be a visibility level in access.json"],
    ["repo 類的交辦沒有外部編號", (d: any) => delete d.assignments[0].externalRef, "assignments[0].externalRef: is required for a repo source"],
    ["repo 類的工作沒有外部編號", (d: any) => delete d.assignments[0].works[0].externalRef, "works[0].externalRef: is required for a repo source"],
    ["repo 類的外部編號不是正整數", (d: any) => (d.assignments[0].externalRef = "A-1"), "assignments[0].externalRef: must be a positive integer string"],
    ["外部編號是數字而不是文字", (d: any) => (d.assignments[0].works[0].externalRef = 201), "works[0].externalRef: must be a non-empty string"],
    ["外部編號是空字串", (d: any) => {
      d.sources[0].kind = "mailbox";
      d.assignments[0].externalRef = " ";
    }, "assignments[0].externalRef: must be a non-empty string"],
  ])("工作來源與外部編號：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it("repo 以外的類型：外部編號可以省略，名稱不限 example-org/；有值時同一來源內不重複", () => {
    const mailbox = (d: any) => {
      d.sources[0] = { id: "lantern-notes", kind: "mailbox", name: "Support inbox", project: "bluewing" };
      for (const a of d.assignments) {
        delete a.externalRef;
        for (const w of a.works) delete w.externalRef;
      }
    };
    expect(errorsAfter(mailbox)).toEqual([]);
    const duplicated = errorsAfter((d: any) => {
      mailbox(d);
      d.assignments[0].externalRef = "MSG-1";
      d.assignments[1].externalRef = "MSG-1";
    });
    expect(duplicated.join("\n")).toContain("assignments[1].externalRef: duplicate");
  });

  it("今天、到期日與優先順序（#133）：可以省略；有值時是存在的日期與三種之一，到期日不必早於現在", () => {
    expect(errorsAfter((d: any) => {
      d.today = "2026-11-20";
      d.assignments[0].dueAt = "2030-01-01";
      d.assignments[0].priority = "high";
      d.assignments[1].priority = "low";
    })).toEqual([]);
    const errors = errorsAfter((d: any) => {
      d.today = "2026-11-31";
      d.assignments[0].dueAt = "2026-11-20T00:00:00Z";
      d.assignments[1].priority = "urgent";
    }).join("\n");
    expect(errors).toContain("demo.today: must be a date (YYYY-MM-DD)");
    expect(errors).toContain("assignments[0].dueAt: must be a date (YYYY-MM-DD)");
    expect(errors).toContain("assignments[1].priority: must be one of high, normal, low");
  });

  const awaiting = (d: any) => d.assignments[1].works[0];
  it.each([
    ["等待驗收的交件是一行摘要", (d: any) => (awaiting(d).body = t("本文", "Body")), "works[0].body: must have sections while waiting for review"],
    ["只有一種語言有結構", (d: any) => (awaiting(d).body.en = "Body"), "works[0].body: must have sections in every language or in none"],
    ["格式錯誤（標記沒有關閉）", (d: any) => (awaiting(d).body.en = "@@ src/a.ts [modified]\nAdd 〔1〕sorting"), "works[0].body.en: line 2: unclosed-mark (src/a.ts)"],
    ["重點沒有標出位置", (d: any) => awaiting(d).points.push(t("第二個重點", "Second point")), "works[0].body.zh-TW: point 2 must be marked in the body"],
    ["changes 的位置不是區塊的鍵", (d: any) => (awaiting(d).changes[0].path = "src/b.ts"), "works[0].body.en: changes path src/b.ts must be a section key"],
    ["兩種語言的屬性不同", (d: any) => (awaiting(d).body.en = "@@ src/a.ts [added]\nAdd 〔1〕sorting〔/1〕"), "works[0].body.en: sections must match zh-TW"],
    ["兩種語言的重點位置不同", (d: any) => (awaiting(d).body.en = "@@ src/a.ts [modified] [point 1]\nAdd sorting"), "works[0].body.en: sections must match zh-TW"],
    [
      "區塊的鍵不符合工作類型",
      (d: any) => {
        d.workTypes.push("support");
        d.assignments[1].workType = "support";
      },
      "works[0].body.zh-TW: section src/a.ts does not fit work type support",
    ],
    ["模擬回覆的全文也檢查", (d: any) => (d.simulations[0].replies[0].body = { ...SECTIONS, en: "@@ src/a.ts\nAdd sorting" }), "simulations[0].replies[0].body.en: point 1 must be marked"],
  ])("交件全文（#65）：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it("交件全文：一行摘要的歷史交件與模擬回覆不檢查位置（舊格式）", () => {
    expect(errorsAfter((d: any) => (d.simulations[0].replies[0].points = [t("一", "One"), t("二", "Two")]))).toEqual([]);
  });

  it("demo.json：改寫的 16 份與 #134 新增的 3 份全文都有結構，其他交件維持一行摘要（#65 的 `## 決定` 3）", () => {
    // #134 新增的 c12、j11（等驗收）與 k15（修正中）是有結構的全文；s16（修正中）是一行摘要
    const added = ["c12", "j11", "k15"];
    const rewritten = ["s14", "c11", "k13", "j06", "s13", "c10", "k12", "j05", ...added];
    const works = DEMO!.assignments.flatMap((a) => a.works.map((w) => ({ id: a.id, w })));
    const replies = DEMO!.simulations.flatMap((s) => s.replies);
    for (const language of clientConfig.client.languages) {
      const structured = (w: { body: Record<string, string>; points: unknown[] }) => parseWorkBody(w.body[language], w.points.length).structured;
      expect(works.filter(({ w }) => structured(w)).map(({ id }) => id).sort(), language).toEqual([...rewritten].sort());
      expect(replies.every(structured), language).toBe(true);
    }
    expect(rewritten.length - added.length + replies.length).toBe(16);
  });

  // 守則（#142）：附錄 A 的規則
  const g = (d: any, i: number) => d.guidelines[i];
  const decide = (decision: string, decidedAt: string, revisedText?: unknown) => ({ decision, decidedBy: "manager", decidedAt, ...(revisedText ? { revisedText } : {}) });
  const follows = (d: any) => d.assignments[1].works[0];
  it.each([
    ["來源退回不存在", (d: any) => (g(d, 1).sourceReview = "nope"), "guidelines[1].sourceReview: must be a review in this file"],
    ["來源是通過", (d: any) => (g(d, 1).sourceReview = "j01-2"), "guidelines[1].sourceReview: must be a return with reason wrong or different_approach and a note"],
    ["來源退回的原因是流程上的小問題", (d: any) => (d.assignments[0].works[0].review.reason = "process"), "guidelines[0].sourceReview: must be a return with reason"],
    ["來源退回沒有意見", (d: any) => delete d.assignments[0].works[0].review.note, "guidelines[1].sourceReview: must be a return with reason"],
    ["守則與來源的員工 × 工作類型不同", (d: any) => {
      d.workTypes.push("docs");
      g(d, 1).workType = "docs";
    }, "guidelines[1].sourceReview: must belong to the same employee and work type"],
    ["重複的守則 id", (d: any) => (g(d, 1).id = "g01"), "guidelines[1].id: duplicate: g01"],
    ["提出者不在列舉中", (d: any) => (g(d, 1).proposer = "system"), "guidelines[1].proposer: must be one of human, employee"],
    ["人提的提出時間不是退回的時間", (d: any) => (g(d, 0).proposedAt = "2026-09-02T16:00:00+08:00"), "guidelines[0].proposedAt: must equal the source review's decidedAt"],
    ["人提的文字不是退回的意見", (d: any) => (g(d, 0).text = t("別的話", "Something else")), "guidelines[0].text: must equal the source review's note"],
    ["人提的第一筆決定不是確認", (d: any) => (g(d, 0).decisions = [decide("reject", "2026-09-02T15:00:00+08:00")]), "guidelines[0].decisions[0]: must be a confirm at proposedAt"],
    ["人提的確認晚於提出", (d: any) => (g(d, 0).decisions[0].decidedAt = "2026-09-02T15:30:00+08:00"), "guidelines[0].decisions[0]: must be a confirm at proposedAt"],
    ["人提的確認者不是退回的驗收者", (d: any) => {
      d.assignments[0].works[0].review.decidedBy = "lead";
    }, "guidelines[0].decisions[0].decidedBy: must be the source review's decidedBy"],
    ["人提沒有決定", (d: any) => (g(d, 0).decisions = []), "guidelines[0].decisions: must start with a confirm"],
    ["員工提出早於來源退回", (d: any) => (g(d, 1).proposedAt = "2026-09-02T14:00:00+08:00"), "guidelines[1].proposedAt: must be after the source review"],
    ["決定早於提出", (d: any) => g(d, 1).decisions.push(decide("confirm", "2026-09-02T15:30:00+08:00")), "guidelines[1].decisions[0].decidedAt: must be after proposedAt"],
    ["收回早於確認", (d: any) => g(d, 0).decisions.push(decide("revoke", "2026-09-02T14:00:00+08:00")), "guidelines[0].decisions[1].decidedAt: must be after the previous decision"],
    ["不採用後再確認", (d: any) => g(d, 1).decisions.push(decide("reject", "2026-09-03T09:00:00+08:00"), decide("confirm", "2026-09-03T10:00:00+08:00")), "guidelines[1].decisions[1].decision: cannot confirm after reject"],
    ["收回後再確認", (d: any) => g(d, 0).decisions.push(decide("revoke", "2026-09-06T09:00:00+08:00"), decide("confirm", "2026-09-06T10:00:00+08:00")), "guidelines[0].decisions[2].decision: cannot confirm after confirm, revoke"],
    ["沒有確認就收回", (d: any) => g(d, 1).decisions.push(decide("revoke", "2026-09-03T09:00:00+08:00")), "guidelines[1].decisions[0].decision: cannot revoke after nothing"],
    ["決定不在列舉中", (d: any) => g(d, 1).decisions.push(decide("approve", "2026-09-03T09:00:00+08:00")), "guidelines[1].decisions[0].decision: must be one of confirm, reject, revoke"],
    ["修改的文字出現在不採用", (d: any) => g(d, 1).decisions.push(decide("reject", "2026-09-03T09:00:00+08:00", t("改", "Edit"))), "guidelines[1].decisions[0].revisedText: is only for a confirm"],
    ["修改的文字缺少 en", (d: any) => g(d, 1).decisions.push(decide("confirm", "2026-09-03T09:00:00+08:00", { "zh-TW": "改" })), "guidelines[1].decisions[0].revisedText.en: must be a non-empty string"],
    ["退回的意見缺少 en", (d: any) => delete d.assignments[0].works[0].review.note.en, "works[0].review.note.en: must be a non-empty string"],
    ["依照的守則不存在", (d: any) => (follows(d).guidelines = ["nope"]), "works[0].guidelines[0]: must be a guideline in this file"],
    ["依照等確認的守則", (d: any) => (follows(d).guidelines = ["g02"]), "works[0].guidelines[0]: guideline g02 must be active when the work was submitted"],
    ["依照交件後才確認的守則", (d: any) => {
      g(d, 1).decisions.push(decide("confirm", "2026-09-05T12:00:00+08:00"));
      follows(d).guidelines = ["g02"];
    }, "guideline g02 must be active when the work was submitted"],
    ["依照已收回的守則", (d: any) => g(d, 0).decisions.push(decide("revoke", "2026-09-04T10:00:00+08:00")), "works[0].guidelines[0]: guideline g01 must be active when the work was submitted"],
    ["依照別的員工 × 工作類型的守則", (d: any) => {
      d.workTypes.push("docs");
      d.assignments[1].workType = "docs";
    }, "works[0].guidelines[0]: must belong to the same employee and work type"],
    ["同一次交件重複依照", (d: any) => (follows(d).guidelines = ["g01", "g01"]), "works[0].guidelines[1]: duplicate: g01"],
  ])("守則（#142）：%s", (_name, change, expected) => {
    expect(errorsAfter(change).join("\n")).toContain(expected);
  });

  it.each([
    ["修改後確認", (d: any) => g(d, 1).decisions.push(decide("confirm", "2026-09-03T09:00:00+08:00", t("結論寫在第一句", "Put the conclusion in the first sentence")))],
    ["不採用", (d: any) => g(d, 1).decisions.push(decide("reject", "2026-09-03T09:00:00+08:00"))],
    ["交件之後收回", (d: any) => g(d, 0).decisions.push(decide("revoke", "2026-09-06T09:00:00+08:00"))],
    ["流程上的小問題也可以寫意見（只是不能成為守則）", (d: any) => {
      d.assignments[0].works[1].review = { id: "j01-2", verdict: "returned", reason: "process", note: t("檔名改小寫", "Use lowercase file names"), decidedBy: "manager", decidedAt: "2026-09-03T15:00:00+08:00" };
      d.levelDecisions = [];
    }],
    ["沒有守則", (d: any) => {
      d.guidelines = [];
      delete follows(d).guidelines;
    }],
  ])("守則（#142）：%s 不是錯誤", (_name, change) => {
    expect(errorsAfter(change)).toEqual([]);
  });

  it("demo.json 的守則：附錄 A 的 6 條與 37 次依照（#142）", () => {
    const guidelines = DEMO!.guidelines.map((x) => [x.id, x.proposer, x.decisions.map((d) => d.decision).join("+")].join(" "));
    expect(guidelines).toEqual(["g04 human confirm+revoke", "g03 human confirm", "g06 employee reject", "g01 human confirm", "g05 employee confirm", "g02 employee "]);
    const follows = new Map<string, string[]>();
    for (const a of DEMO!.assignments) for (const w of a.works) for (const id of w.guidelines ?? []) follows.set(id, [...(follows.get(id) ?? []), `${a.id}-w${w.round}`]);
    const ids = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, "0")}-w1`);
    expect(follows.get("g01")).toEqual([...ids("s", 6, 14), "s16-w1"]);
    expect(follows.get("g03")?.sort()).toEqual(ids("c", 2, 12));
    expect(follows.get("g04")?.sort()).toEqual(ids("k", 2, 10));
    expect(follows.get("g05")?.sort()).toEqual([...ids("k", 8, 13), "k15-w1"]);
    expect([...follows.values()].flat()).toHaveLength(37);
    // 有意見但沒有成為守則：s16-1、k15-1；流程上的小問題：c05-1、j04-1
    const sources = new Set(DEMO!.guidelines.map((x) => x.sourceReview));
    const noted = DEMO!.assignments.flatMap((a) => a.works.flatMap((w) => (w.review?.note ? [w.review.id] : [])));
    expect(noted.filter((id) => !sources.has(id)).sort()).toEqual(["c05-1", "j04-1", "k15-1", "s16-1"]);
  });

  it("來源的顯示名稱（label）可以省略；有的話雙語齊全即通過（#60）", () => {
    expect(errorsAfter((d: any) => (d.sources[0].label = t("筆記", "Notes")))).toEqual([]);
    expect(errorsAfter((d: any) => delete d.sources[0].label)).toEqual([]);
  });

  it("languages 選項決定雙語欄位必須有的語言", () => {
    const errors = validateDemo(fixture(), access, { now: NOW, languages: ["zh-TW", "en", "ja"] });
    expect(errors).toContain("employees[0].roleNote.ja: must be a non-empty string");
  });

  it("assertDemo 不通過時拋出列出錯誤的 Error", () => {
    const demo = fixture();
    demo.assignments[0].source = "nowhere";
    expect(() => assertDemo(demo, access, { now: NOW })).toThrow(/assignments\[0\]\.source/);
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
    expect(demoText("body", w1, "zh-TW", index)).toBe("本文");
    expect(demoText("point", `${w1}/1`, "en", index)).toBe("Point");
    expect(demoText("change", `${w1}/1`, "zh-TW", index)).toBe("變更");
  });

  it("reviewNote、guideline、guidelineRevision：退回的意見、守則提出的文字與確認時修改的文字（#142）", () => {
    const revised = fixture();
    revised.guidelines[1].decisions.push({ decision: "confirm", decidedBy: "manager", decidedAt: "2026-09-03T09:00:00+08:00", revisedText: t("改過", "Revised") });
    const revisedIndex = demoTextIndex(revised);
    expect(demoText("reviewNote", "j01-1", "en", index)).toBe("Lead with the conclusion");
    expect(demoText("reviewNote", "j01-2", "en", index)).toBeNull();
    expect(demoText("guideline", "g02", "zh-TW", index)).toBe("結論放第一段");
    expect(demoText("guidelineRevision", "g02-d1", "en", revisedIndex)).toBe("Revised");
    expect(demoText("guidelineRevision", "g01-d1", "en", revisedIndex)).toBeNull();
  });

  it("sourceName：來源有 label 時以來源 id 查得到，沒有 label 時是 null（#60）", () => {
    const withLabel = fixture();
    withLabel.sources[0].label = t("筆記", "Notes");
    expect(demoText("sourceName", "lantern-notes", "zh-TW", demoTextIndex(withLabel))).toBe("筆記");
    expect(demoText("sourceName", "lantern-notes", "en", demoTextIndex(withLabel))).toBe("Notes");
    expect(demoText("sourceName", "lantern-notes", "en", index)).toBeNull();
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
