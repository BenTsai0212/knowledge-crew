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
import { actorName, filterLedger, inLevelFilter, isLevelChange, ledgerOptions, ledgerTone, mergeLedger, readLedger, type LedgerEvent, type LedgerKind } from "./ledger";

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
        employeeId: "basil", assignedBy: "manager", assignedAt: T1, latestRound: 1, latestVerdict: "returned" as const,
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

  it("提出少看建議（#125）：依規則自動、帶依據，在觸發它的驗收上方；看不到的驗收不列出", () => {
    const accepted = { ...sources, reviews: [{ ...sources.reviews[0], verdict: "accepted" as const, reason: null }], decisions: [], resets: [] };
    const events = mergeLedger({ ...accepted, proposals: [{ reviewId: "rv1", at: T2, basis: ["rv1"] }] }, lang);
    expect(events.map((e) => e.kind)).toEqual(["proposed", "accepted", "submitted", "assigned"]);
    expect(events[0]).toMatchObject({ id: "proposed:rv1", actor: null, assignment: { id: "a1" }, basis: ["rv1"], round: null, reason: null });
    expect(mergeLedger({ ...accepted, proposals: [{ reviewId: "unknown", at: T2, basis: [] }] }, lang).some((e) => e.kind === "proposed")).toBe(false);
    // 省略 proposals 時沒有這種事件
    expect(mergeLedger(accepted, lang).some((e) => e.kind === "proposed")).toBe(false);
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

  it("依事件：只看層級改變（同意少看、收回少看、改回逐項看）、只看退回；all 與省略時全部（#77）", () => {
    const mixed = [
      event("a", "autoReset", "2026-10-05T00:00:00.000Z"),
      event("b", "returned", "2026-10-05T00:00:00.000Z"),
      event("c", "relax", "2026-10-04T00:00:00.000Z", "juniper", "ui"),
      event("d", "accepted", "2026-10-03T00:00:00.000Z"),
      event("e", "revoke", "2026-10-02T00:00:00.000Z"),
      event("f", "submitted", "2026-10-01T00:00:00.000Z"),
      event("g", "proposed", "2026-09-30T00:00:00.000Z"),
    ];
    // 提出少看建議也在「只看層級改變」（#125）
    expect(filterLedger(mixed, { event: "level" }).map((e) => e.id)).toEqual(["a", "c", "e", "g"]);
    expect(filterLedger(mixed, { event: "returned" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterLedger(mixed, { event: "all" })).toHaveLength(7);
    expect(filterLedger(mixed, { employeeId: "basil", event: "level" }).map((e) => e.id)).toEqual(["a", "e", "g"]);
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
    // 提出少看建議不改變層級：不是灰底，但在「只看層級改變」的篩選裡（#125）
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
  it("manager：四個來源的全部事件，含 Rowan、Linden、Juniper 的同意少看、Juniper 的收回、Rowan 的改回逐項看與提出少看建議", async () => {
    const events = await readLedger(db, "manager", lang);
    expect(countKinds(events)).toEqual({ assigned: 48, submitted: 56, accepted: 44, returned: 8, proposed: 4, relax: 3, revoke: 1, autoReset: 1 });
    expect(events).toHaveLength(165);
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
    expect(events).toHaveLength(85);
    expect(countKinds(events)).toEqual({ assigned: 25, submitted: 29, accepted: 23, returned: 4, proposed: 2, relax: 1, autoReset: 1 });
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
    // 青翼專案（staff 看得到）的組合先少看：Sorrel × 貼文與商品介紹
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

  it("manager 對 Juniper × 網站與工具開發同意少看：manager 看得到，staff 看不到（#40 的 `## 決定` 1）", async () => {
    const staffBefore = await readLedger(db, "staff", lang);
    const d = await createLevelDecision(db, "manager", { employeeId: "juniper", workTypeId: "dev", decision: "relax" });
    const manager = await readLedger(db, "manager", lang);
    expect(manager.find((e) => e.id === `relax:${d.id}`)).toMatchObject({ employee: { id: "juniper" }, workTypeId: "dev", actor: "manager", assignment: null });
    const staff = await readLedger(db, "staff", lang);
    expect(staff.some((e) => e.id === `relax:${d.id}`)).toBe(false);
    expect(staff).toHaveLength(staffBefore.length);
  });
});
