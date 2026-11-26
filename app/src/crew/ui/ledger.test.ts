// 「工作帳本」的資料整理（#40）：純函式的排序與篩選，以及匯入虛構資料後三種身分看到的事件。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createAssignment, createLevelDecision, createReview } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { simulateSubmission } from "../demo/simulate";
import type { DemoFile } from "../demo/types";
import {
  actorName, filterLedger, inLevelFilter, isGuidelineEvent, isLevelChange, ledgerOptions, ledgerTone, mergeLedger, readLedger, truncateText,
  type LedgerEvent, type LedgerGuideline, type LedgerKind,
} from "./ledger";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;

// 來源的顯示名稱（#60 的 `## 決定` 2）：有 label 時是目前語言的 label，否則是 name
const label = (id: string, language = lang) => {
  const s = demo.sources.find((x) => x.id === id)!;
  return s.label?.[language] ?? s.name;
};
const SOURCE_NAMES = demo.sources.map((s) => label(s.id));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

const countKinds = (events: LedgerEvent[]) => {
  const counts: Partial<Record<LedgerKind, number>> = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
};

const event = (id: string, kind: LedgerKind, at: string, employeeId = "basil", workTypeId = "docs"): LedgerEvent => ({
  id,
  kind,
  at,
  employee: { id: employeeId, displayName: employeeId },
  workTypeId,
  assignment: null,
  actor: null,
  round: null,
  reason: null,
});

describe("mergeLedger：排序", () => {
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-02T00:00:00.000Z";
  const sources = {
    assignments: [
      {
        id: "a1", sourceId: "r", sourceKind: "repo" as const, sourceName: "example-org/r", externalRef: "1", title: "A1", workTypeId: "docs",
        employeeId: "basil", assignedBy: "manager", assignedAt: T1, dueAt: null, priority: "normal" as const, latestRound: 1, latestVerdict: "returned" as const,
      },
    ],
    employees: [{ id: "basil", displayName: "Basil" }],
    works: [{ id: "w1", assignmentId: "a1", round: 1, submittedAt: T2 }],
    reviews: [{ id: "rv1", workId: "w1", verdict: "returned" as const, reason: "wrong" as const, decidedBy: "manager", decidedAt: T2 }],
    decisions: [
      { id: "d1", employeeId: "basil", workTypeId: "docs", decision: "relax" as const, basisReviewId: null, decidedBy: "manager", decidedAt: T2 },
    ],
    resets: [{ reviewId: "rv1", at: T2 }],
  };

  it("新到舊；同一時間依 改回逐項看 → 驗收 → 層級決定 → 交件 → 交辦", () => {
    const events = mergeLedger(sources, lang);
    expect(events.map((e) => e.kind)).toEqual(["autoReset", "returned", "relax", "submitted", "assigned"]);
    expect(events[0]).toMatchObject({ actor: null, assignment: { id: "a1" } });
    expect(events[1]).toMatchObject({ reason: "wrong", actor: "manager", round: 1 });
    expect(events[2].assignment).toBeNull();
    expect(events[3]).toMatchObject({ round: 1, actor: "basil" });
  });

  it("提出看重點的建議（#125）：依規則自動、帶依據，在觸發它的驗收上方；看不到的驗收不列出", () => {
    const accepted = { ...sources, reviews: [{ ...sources.reviews[0], verdict: "accepted" as const, reason: null }], decisions: [], resets: [] };
    const events = mergeLedger({ ...accepted, proposals: [{ reviewId: "rv1", at: T2, basis: ["rv1"] }] }, lang);
    expect(events.map((e) => e.kind)).toEqual(["proposed", "accepted", "submitted", "assigned"]);
    expect(events[0]).toMatchObject({ id: "proposed:rv1", actor: null, assignment: { id: "a1" }, basis: ["rv1"], round: null, reason: null });
    expect(mergeLedger({ ...accepted, proposals: [{ reviewId: "unknown", at: T2, basis: [] }] }, lang).some((e) => e.kind === "proposed")).toBe(false);
    // 省略 proposals 時沒有這種事件
    expect(mergeLedger(accepted, lang).some((e) => e.kind === "proposed")).toBe(false);
  });

  it("事後更正（#164）：時間是更正時間、經手人是更正者、帶輪次與備註；由它觸發的改回逐項看標出 byCorrection，列在更正上方", () => {
    const T3 = "2026-10-03T00:00:00.000Z";
    const accepted = { ...sources, reviews: [{ ...sources.reviews[0], verdict: "accepted" as const, reason: null }], decisions: [] };
    const correction = { id: "c1", reviewId: "rv1", note: "期限寫錯了", correctedBy: "manager", correctedAt: T3 };
    const events = mergeLedger({ ...accepted, resets: [{ reviewId: "rv1", at: T3, byCorrection: true }], corrections: [correction] }, lang);
    expect(events.map((e) => e.kind)).toEqual(["autoReset", "corrected", "accepted", "submitted", "assigned"]);
    expect(events[0]).toMatchObject({ byCorrection: true, actor: null });
    expect(events[1]).toMatchObject({ id: "corrected:c1", at: T3, actor: "manager", round: 1, note: "期限寫錯了", assignment: { id: "a1" } });
    // 沒寫備註時沒有 note；一般的改回逐項看沒有 byCorrection
    const plain = mergeLedger({ ...accepted, resets: [{ reviewId: "rv1", at: T3 }], corrections: [{ ...correction, note: null }] }, lang);
    expect(plain.find((e) => e.kind === "corrected")).not.toHaveProperty("note");
    expect(plain.find((e) => e.kind === "autoReset")).not.toHaveProperty("byCorrection");
    // 看不到的驗收不列出
    expect(mergeLedger({ ...accepted, resets: [], corrections: [{ ...correction, reviewId: "unknown" }] }, lang).some((e) => e.kind === "corrected")).toBe(false);
  });

  describe("守則的事件（#145）", () => {
    const T3 = "2026-10-03T00:00:00.000Z";
    const guideline = (over: Partial<LedgerGuideline>): LedgerGuideline => ({
      id: "g1", employeeId: "basil", workTypeId: "docs", sourceAssignmentId: "a1", proposerKind: "human", proposedBy: "manager", proposedAt: T2,
      text: "先回答結論", decisions: [{ id: "gd1", decision: "confirm", revisedText: null, decidedBy: "manager", decidedAt: T2 }], ...over,
    });
    const base = { ...sources, decisions: [], resets: [] };

    it("人提：「記成守則」（經手人是驗收者），同時的確認不另列；與那次退回同時，退回在前、記成守則在後", () => {
      const events = mergeLedger({ ...base, guidelines: [guideline({})] }, lang);
      expect(events.map((e) => e.kind)).toEqual(["returned", "guidelineSaved", "submitted", "assigned"]);
      expect(events[1]).toMatchObject({ id: "guidelineSaved:g1", actor: "manager", assignment: { id: "a1" }, guideline: { id: "g1", text: "先回答結論" } });
    });

    it("員工提：「提出守則」（經手人是員工）；之後的確認、修改後確認、不採用、收回（經手人是決定者）", () => {
      const employee = guideline({ proposerKind: "employee", proposedBy: null, decisions: [] });
      const at = (kind: "confirm" | "reject" | "revoke", revisedText: string | null = null, i = 1) =>
        ({ id: `gd${i}`, decision: kind, revisedText, decidedBy: "manager", decidedAt: T3 });
      expect(mergeLedger({ ...base, guidelines: [employee] }, lang).find((e) => e.kind === "guidelineProposed")).toMatchObject({ actor: "basil", at: T2 });
      const kinds = (decisions: LedgerGuideline["decisions"]) =>
        mergeLedger({ ...base, guidelines: [{ ...employee, decisions }] }, lang).filter((e) => isGuidelineEvent(e.kind)).map((e) => [e.kind, e.actor]);
      expect(kinds([at("confirm")])).toEqual([["guidelineConfirmed", "manager"], ["guidelineProposed", "basil"]]);
      expect(kinds([at("confirm", "改過")])).toEqual([["guidelineEdited", "manager"], ["guidelineProposed", "basil"]]);
      expect(kinds([at("reject")])).toEqual([["guidelineRejected", "manager"], ["guidelineProposed", "basil"]]);
      // 人提的守則收回
      const revoked = mergeLedger({ ...base, guidelines: [guideline({ decisions: [...guideline({}).decisions, at("revoke", null, 2)] })] }, lang);
      expect(revoked.filter((e) => isGuidelineEvent(e.kind)).map((e) => e.kind)).toEqual(["guidelineRetired", "guidelineSaved"]);
    });

    it("每個事件帶當時的文字：提出是提出時的、修改後確認是修改後的，之後的收回是修改後的；不採用是提出時的", () => {
      const at = (id: string, kind: "confirm" | "reject" | "revoke", revisedText: string | null, decidedAt: string) =>
        ({ id, decision: kind, revisedText, decidedBy: "manager", decidedAt });
      const T4 = "2026-10-04T00:00:00.000Z";
      const texts = (g: LedgerGuideline) =>
        mergeLedger({ ...base, guidelines: [g] }, lang).filter((e) => isGuidelineEvent(e.kind)).map((e) => [e.kind, e.guideline!.text]);
      const employee = guideline({ proposerKind: "employee", proposedBy: null });
      expect(texts({ ...employee, decisions: [at("gd1", "confirm", "改過的文字", T3), at("gd2", "revoke", null, T4)] })).toEqual([
        ["guidelineRetired", "改過的文字"], ["guidelineEdited", "改過的文字"], ["guidelineProposed", "先回答結論"],
      ]);
      expect(texts({ ...employee, decisions: [at("gd1", "confirm", null, T3), at("gd2", "revoke", null, T4)] })).toEqual([
        ["guidelineRetired", "先回答結論"], ["guidelineConfirmed", "先回答結論"], ["guidelineProposed", "先回答結論"],
      ]);
      expect(texts({ ...employee, decisions: [at("gd1", "reject", null, T3)] })).toEqual([
        ["guidelineRejected", "先回答結論"], ["guidelineProposed", "先回答結論"],
      ]);
    });

    it("看不到來源交辦時沒有工作（assignment 是 null），守則的事件照樣列出", () => {
      const events = mergeLedger({ ...base, guidelines: [guideline({ sourceAssignmentId: "hidden" })] }, lang);
      expect(events.find((e) => e.kind === "guidelineSaved")).toMatchObject({ assignment: null, employee: { id: "basil", displayName: "Basil" } });
    });
  });

  it("層級決定只列出看得到該員工 × 該工作類型交辦的", () => {
    const hidden = { ...sources, decisions: [{ ...sources.decisions[0], workTypeId: "ui" }] };
    expect(mergeLedger(hidden, lang).some((e) => e.kind === "relax")).toBe(false);
  });
});

describe("filterLedger 與 ledgerOptions", () => {
  const events = [
    event("1", "assigned", "2026-10-03T00:00:00.000Z", "basil", "docs"),
    event("2", "assigned", "2026-10-02T00:00:00.000Z", "juniper", "ui"),
    event("3", "assigned", "2026-10-01T00:00:00.000Z", "basil", "ui"),
  ];

  it("依員工、依工作類型、兩者並用；沒有條件時全部", () => {
    expect(filterLedger(events, {}).map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(filterLedger(events, { employeeId: "basil" }).map((e) => e.id)).toEqual(["1", "3"]);
    expect(filterLedger(events, { workTypeId: "ui" }).map((e) => e.id)).toEqual(["2", "3"]);
    expect(filterLedger(events, { employeeId: "basil", workTypeId: "ui" }).map((e) => e.id)).toEqual(["3"]);
    expect(filterLedger(events, { employeeId: null, workTypeId: null })).toHaveLength(3);
  });

  it("依事件：只看層級改變（同意改看重點、收回看重點、改回逐項看）、只看退回；all 與省略時全部（#77）", () => {
    const mixed = [
      event("a", "autoReset", "2026-10-05T00:00:00.000Z"),
      event("b", "returned", "2026-10-05T00:00:00.000Z"),
      event("c", "relax", "2026-10-04T00:00:00.000Z", "juniper", "ui"),
      event("d", "accepted", "2026-10-03T00:00:00.000Z"),
      event("e", "revoke", "2026-10-02T00:00:00.000Z"),
      event("f", "submitted", "2026-10-01T00:00:00.000Z"),
      event("g", "proposed", "2026-09-30T00:00:00.000Z"),
    ];
    // 提出看重點的建議也在「只看層級改變」（#125）
    expect(filterLedger(mixed, { event: "level" }).map((e) => e.id)).toEqual(["a", "c", "e", "g"]);
    expect(filterLedger(mixed, { event: "returned" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterLedger(mixed, { event: "all" })).toHaveLength(7);
    expect(filterLedger(mixed, { employeeId: "basil", event: "level" }).map((e) => e.id)).toEqual(["a", "e", "g"]);
  });

  it("事後更正（#164）在「只看退回」；由更正觸發的改回逐項看在「只看層級改變」；更正是 danger 樣式", () => {
    const reset = { ...event("a", "autoReset", "2026-10-05T00:00:00.000Z"), byCorrection: true as const };
    const mixed = [reset, event("b", "corrected", "2026-10-05T00:00:00.000Z"), event("c", "returned", "2026-10-04T00:00:00.000Z")];
    expect(filterLedger(mixed, { event: "returned" }).map((e) => e.id)).toEqual(["b", "c"]);
    expect(filterLedger(mixed, { event: "level" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterLedger(mixed, { event: "guideline" })).toEqual([]);
    expect(ledgerTone({ kind: "corrected", reason: null })).toBe("wrong");
    expect(ledgerTone(reset)).toBe("level");
  });

  it("只看守則（#145）", () => {
    const mixed = [
      event("a", "guidelineSaved", "2026-10-05T00:00:00.000Z"),
      event("b", "returned", "2026-10-05T00:00:00.000Z"),
      event("c", "guidelineRetired", "2026-10-04T00:00:00.000Z"),
      event("d", "relax", "2026-10-03T00:00:00.000Z"),
      event("e", "guidelineProposed", "2026-10-02T00:00:00.000Z"),
    ];
    expect(filterLedger(mixed, { event: "guideline" }).map((e) => e.id)).toEqual(["a", "c", "e"]);
    // 守則的事件不在「只看層級改變」與「只看退回」
    expect(filterLedger(mixed, { event: "level" }).map((e) => e.id)).toEqual(["d"]);
    expect(filterLedger(mixed, { event: "returned" }).map((e) => e.id)).toEqual(["b"]);
    expect(ledgerTone({ kind: "guidelineRetired", reason: null })).toBeNull();
  });

  it("選項只來自目前的事件", () => {
    expect(ledgerOptions(events)).toEqual({ employees: [{ id: "basil", displayName: "basil" }, { id: "juniper", displayName: "juniper" }], workTypeIds: ["docs", "ui"] });
    expect(ledgerOptions([])).toEqual({ employees: [], workTypeIds: [] });
  });
});

describe("isLevelChange 與 ledgerTone（#77）", () => {
  it("層級改變是灰底列；退回只有「做錯了」是 danger；其他沒有樣式", () => {
    expect((["relax", "revoke", "autoReset"] as LedgerKind[]).every(isLevelChange)).toBe(true);
    expect((["assigned", "submitted", "accepted", "returned"] as LedgerKind[]).some(isLevelChange)).toBe(false);
    expect(ledgerTone({ kind: "relax", reason: null })).toBe("level");
    expect(ledgerTone({ kind: "autoReset", reason: null })).toBe("level");
    expect(ledgerTone({ kind: "returned", reason: "wrong" })).toBe("wrong");
    expect(ledgerTone({ kind: "returned", reason: "different_approach" })).toBeNull();
    expect(ledgerTone({ kind: "returned", reason: "process" })).toBeNull();
    expect(ledgerTone({ kind: "accepted", reason: null })).toBeNull();
    // 提出看重點的建議不改變層級：不是灰底，但在「只看層級改變」的篩選裡（#125）
    expect(isLevelChange("proposed")).toBe(false);
    expect(ledgerTone({ kind: "proposed", reason: null })).toBeNull();
    expect(inLevelFilter("proposed")).toBe(true);
    expect((["relax", "revoke", "autoReset"] as LedgerKind[]).every(inLevelFilter)).toBe(true);
    expect((["assigned", "submitted", "accepted", "returned"] as LedgerKind[]).some(inLevelFilter)).toBe(false);
  });
});

describe("actorName", () => {
  const employees = [{ id: "basil", displayName: "Basil" }];
  it("身分用角色名稱、員工用顯示名稱、找不到時顯示 id、依規則自動是 null", () => {
    expect(actorName(clientConfig.access, employees, "manager", "zh-TW")).toBe("主管");
    expect(actorName(clientConfig.access, employees, "manager", "en")).toBe("Manager");
    expect(actorName(clientConfig.access, employees, "manager", "xx")).toBe("manager");
    expect(actorName(clientConfig.access, employees, "basil", "zh-TW")).toBe("Basil");
    expect(actorName(clientConfig.access, employees, "nobody", "zh-TW")).toBe("nobody");
    expect(actorName(clientConfig.access, employees, null, "zh-TW")).toBeNull();
  });
});

describe("readLedger：匯入虛構資料後", () => {
  it("manager：四個來源的全部事件，含 Rowan、Linden、Juniper 的同意改看重點、Juniper 的收回、Rowan 的改回逐項看與提出看重點的建議", async () => {
    const events = await readLedger(db, "manager", lang);
    // #134 加了交辦 6、交件 4、退回 2（s16-1、k15-1）；#145 加了守則的事件 9（demo 的六條守則與其決定）；
    // #161 加了交辦 10、交件 10、通過 9（s17～s20、j12～j15、k16；k17 待驗收）；#164 列出 k01-2 的事後更正（當時是逐項看，沒有改回）
    expect(countKinds(events)).toEqual({
      assigned: 64, submitted: 70, accepted: 53, returned: 10, corrected: 1, proposed: 4, relax: 3, revoke: 1, autoReset: 1,
      guidelineSaved: 3, guidelineProposed: 3, guidelineEdited: 1, guidelineRejected: 1, guidelineRetired: 1,
    });
    expect(events).toHaveLength(216);
    expect(new Set(events.map((e) => e.assignment?.sourceName).filter((n) => n !== undefined))).toEqual(new Set(SOURCE_NAMES));
    const relax = events.filter((e) => e.kind === "relax");
    expect(relax.map((e) => [e.employee.id, e.workTypeId, e.actor])).toEqual([
      ["juniper", "dev", "manager"],
      ["linden", "knowledge", "manager"],
      ["rowan", "support", "manager"],
    ]);
    expect(events.filter((e) => e.kind === "revoke").map((e) => [e.employee.id, e.workTypeId, e.actor])).toEqual([["juniper", "dev", "manager"]]);
    expect(relax[2]).toMatchObject({ employee: { id: "rowan", displayName: "Rowan" } });
    expect(events.filter((e) => e.kind === "autoReset")).toMatchObject([{ id: "autoReset:s12-1", employee: { id: "rowan" }, workTypeId: "support", actor: null }]);
    for (let i = 1; i < events.length; i++) expect(events[i - 1].at >= events[i].at).toBe(true);
    // 驗收帶著交件的輪次（「驗收通過（第 2 輪）」）
    const accepted = events.filter((e) => e.kind === "accepted");
    expect(accepted.every((e) => e.round !== null && e.round >= 1)).toBe(true);
    expect(accepted.some((e) => e.round! > 1)).toBe(true);
  });

  it("staff：只看到青翼專案（客服信箱、官方社群帳號）的事件", async () => {
    const events = await readLedger(db, "staff", lang);
    // #134 加了青翼專案的交辦 3（s15、s16、c12）、交件 2、退回 1（s16-1）；#145 加了 Rowan、Sorrel 的守則事件 3；
    // #161 加了 s17～s20 的交辦、交件、通過各 4
    expect(events).toHaveLength(106);
    expect(countKinds(events)).toEqual({
      assigned: 32, submitted: 35, accepted: 27, returned: 5, proposed: 2, relax: 1, autoReset: 1, guidelineSaved: 2, guidelineProposed: 1,
    });
    expect(events.filter((e) => e.kind === "relax").map((e) => e.employee.id)).toEqual(["rowan"]);
    expect(events.filter((e) => e.kind === "proposed").map((e) => e.id)).toEqual(["proposed:c09-1", "proposed:s09-1"]);
    const bluewing = [label("support-inbox"), label("social-account")];
    for (const e of events) expect(bluewing).toContain(e.assignment?.sourceName ?? bluewing[0]);
  });

  it("guest 與沒有身分：空陣列，不拋錯", async () => {
    expect(await readLedger(db, "guest", lang)).toEqual([]);
    expect(await readLedger(db, null, lang)).toEqual([]);
  });

  it("交辦標題依目前語言顯示，找不到時是原文", async () => {
    const c11 = demo.assignments.find((a) => a.id === "c11")!;
    for (const language of [lang, other]) {
      const e = (await readLedger(db, "staff", language)).find((x) => x.id === "assigned:c11")!;
      expect(e.assignment!.title).toBe(c11.title[language]);
      expect(e.assignment!.sourceName).toBe(label("social-account", language));
    }
    const e = (await readLedger(db, "staff", "xx")).find((x) => x.id === "assigned:c11")!;
    expect(e.assignment!.title).toBe(c11.title[lang]);
    expect(e.assignment!.sourceName).toBe("Social account");
  });

  it("完整流程（交辦 → 交件 → 退回「做錯了」）後多四筆：改回逐項看、退回、交件、交辦", async () => {
    // 青翼專案（staff 看得到）的組合先看重點：Sorrel × 貼文與商品介紹
    await createLevelDecision(db, "manager", { employeeId: "sorrel", workTypeId: "content", decision: "relax" });
    const before = await readLedger(db, "manager", lang);
    const a = await createAssignment(db, "manager", { sourceId: "social-account", title: "Ledger flow", workTypeId: "content", employeeId: "sorrel" });
    const s = await simulateSubmission(db, "manager", a.id, demo, lang);
    const r = await createReview(db, "manager", { workId: s.workId, verdict: "returned", reason: "wrong" });
    const after = await readLedger(db, "manager", lang);
    expect(after).toHaveLength(before.length + 4);
    expect(after.slice(0, 4).map((e) => e.id)).toEqual([`autoReset:${r.id}`, `returned:${r.id}`, `submitted:${s.workId}`, `assigned:${a.id}`]);
    expect(after[0]).toMatchObject({ actor: null, employee: { id: "sorrel" }, workTypeId: "content", assignment: { id: a.id, title: "Ledger flow" } });
    expect(after[1]).toMatchObject({ kind: "returned", reason: "wrong", actor: "manager", round: 1 });
    expect(after[2]).toMatchObject({ kind: "submitted", round: 1, actor: "sorrel" });
    expect(after[3]).toMatchObject({ kind: "assigned", actor: "manager", assignment: { sourceName: label("social-account") } });
    // staff 同樣看得到青翼專案的這四筆
    expect((await readLedger(db, "staff", lang)).slice(0, 4).map((e) => e.id)).toEqual(after.slice(0, 4).map((e) => e.id));
  });

  it("manager 對 Juniper × 網站與工具開發同意改看重點：manager 看得到，staff 看不到（#40 的 `## 決定` 1）", async () => {
    const staffBefore = await readLedger(db, "staff", lang);
    const d = await createLevelDecision(db, "manager", { employeeId: "juniper", workTypeId: "dev", decision: "relax" });
    const manager = await readLedger(db, "manager", lang);
    expect(manager.find((e) => e.id === `relax:${d.id}`)).toMatchObject({ employee: { id: "juniper" }, workTypeId: "dev", actor: "manager", assignment: null });
    const staff = await readLedger(db, "staff", lang);
    expect(staff.some((e) => e.id === `relax:${d.id}`)).toBe(false);
    expect(staff).toHaveLength(staffBefore.length);
  });
});

describe("truncateText（#145：工作欄的守則文字）", () => {
  it("不超過時原樣；超過時截斷並加上「…」，以字元計", () => {
    expect(truncateText("短的", 40)).toBe("短的");
    expect(truncateText("一二三四五六", 4)).toBe("一二三…");
    expect([...truncateText("x".repeat(50))]).toHaveLength(40);
  });
});

describe("readLedger：守則的事件（#145）", () => {
  it("manager：demo 的守則；修改後確認的文字是修改後的、人提的經手人是驗收者、員工提的經手人是員工", async () => {
    const events = await readLedger(db, "manager", lang);
    const g = (id: string) => events.filter((e) => e.guideline?.id === id).map((e) => [e.kind, e.actor]);
    expect(g("g01")).toEqual([["guidelineSaved", "manager"]]);
    expect(g("g02")).toEqual([["guidelineProposed", "rowan"]]);
    expect(g("g04")).toEqual([["guidelineRetired", "manager"], ["guidelineSaved", "manager"]]);
    expect(g("g05")).toEqual([["guidelineEdited", "manager"], ["guidelineProposed", "linden"]]);
    expect(g("g06")).toEqual([["guidelineRejected", "manager"], ["guidelineProposed", "juniper"]]);
    // 事件帶當時的文字：g05 的「提出守則」是員工提出的文字，「修改後確認守則」是修改後的文字（#146 的修正要求）
    const g05 = demo.guidelines.find((x) => x.id === "g05")!;
    const text = (kind: LedgerKind) => events.find((x) => x.guideline?.id === "g05" && x.kind === kind)!.guideline!.text;
    expect(text("guidelineProposed")).toBe(g05.text[lang]);
    expect(text("guidelineEdited")).toBe(g05.decisions[0].revisedText![lang]);
    expect(text("guidelineProposed")).not.toBe(text("guidelineEdited"));
    // 點了追到來源交辦；員工欄是員工・工作類型
    expect(events.find((e) => e.id === "guidelineSaved:g01")).toMatchObject({ assignment: { id: "s05" }, employee: { id: "rowan" }, workTypeId: "support" });
    // 記成守則與那次退回同時：退回在前（列在上方）
    const saved = events.findIndex((e) => e.id === "guidelineSaved:g01");
    const returned = events.findIndex((e) => e.kind === "returned" && e.assignment?.id === "s05");
    expect(events[returned].at).toBe(events[saved].at);
    expect(returned).toBeLessThan(saved);
  });

  it("文字依目前語言", async () => {
    const e = (await readLedger(db, "manager", other)).find((x) => x.id === "guidelineProposed:g02")!;
    expect(e.guideline!.text).toBe(demo.guidelines.find((x) => x.id === "g02")!.text[other]);
    const g05 = demo.guidelines.find((x) => x.id === "g05")!;
    expect((await readLedger(db, "manager", other)).find((x) => x.id === "guidelineProposed:g05")!.guideline!.text).toBe(g05.text[other]);
  });
});
