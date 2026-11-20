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
import { actorName, filterLedger, ledgerOptions, mergeLedger, readLedger, type LedgerEvent, type LedgerKind } from "./ledger";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;

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
        id: "a1", repoId: "r", repoFullName: "example-org/r", issueNumber: 1, title: "A1", workTypeId: "docs",
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
    expect(events[1]).toMatchObject({ reason: "wrong", actor: "manager" });
    expect(events[2].assignment).toBeNull();
    expect(events[3]).toMatchObject({ round: 1, actor: "basil" });
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

  it("選項只來自目前的事件", () => {
    expect(ledgerOptions(events)).toEqual({ employees: [{ id: "basil", displayName: "basil" }, { id: "juniper", displayName: "juniper" }], workTypeIds: ["docs", "ui"] });
    expect(ledgerOptions([])).toEqual({ employees: [], workTypeIds: [] });
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
  it("manager：兩個 repo 的全部事件，含 Juniper × 介面的同意少看", async () => {
    const events = await readLedger(db, "manager", lang);
    expect(countKinds(events)).toEqual({ assigned: 26, submitted: 30, accepted: 24, returned: 4, relax: 1 });
    expect(events).toHaveLength(85);
    expect(new Set(events.map((e) => e.assignment?.repoFullName))).toEqual(new Set(["example-org/lantern-notes", "example-org/harbor-docs"]));
    const relax = events.filter((e) => e.kind === "relax");
    expect(relax).toHaveLength(1);
    expect(relax[0]).toMatchObject({ employee: { id: "juniper", displayName: "Juniper" }, workTypeId: "ui", actor: "manager" });
    for (let i = 1; i < events.length; i++) expect(events[i - 1].at >= events[i].at).toBe(true);
  });

  it("staff：只看到青翼專案（lantern-notes）的事件", async () => {
    const events = await readLedger(db, "staff", lang);
    expect(events).toHaveLength(49);
    expect(countKinds(events).relax).toBe(1);
    for (const e of events) expect(e.assignment?.repoFullName ?? "example-org/lantern-notes").toBe("example-org/lantern-notes");
  });

  it("guest 與沒有身分：空陣列，不拋錯", async () => {
    expect(await readLedger(db, "guest", lang)).toEqual([]);
    expect(await readLedger(db, null, lang)).toEqual([]);
  });

  it("交辦標題依目前語言顯示，找不到時是原文", async () => {
    const j13 = demo.assignments.find((a) => a.id === "j13")!;
    for (const language of [lang, other]) {
      const e = (await readLedger(db, "staff", language)).find((x) => x.id === "assigned:j13")!;
      expect(e.assignment!.title).toBe(j13.title[language]);
    }
    const e = (await readLedger(db, "staff", "xx")).find((x) => x.id === "assigned:j13")!;
    expect(e.assignment!.title).toBe(j13.title[lang]);
  });

  it("完整流程（交辦 → 交件 → 退回「做錯了」）後多四筆：改回逐項看、退回、交件、交辦", async () => {
    const before = await readLedger(db, "manager", lang);
    const a = await createAssignment(db, "manager", { repoId: "lantern-notes", title: "Ledger flow", workTypeId: "ui", employeeId: "juniper" });
    const s = await simulateSubmission(db, "manager", a.id, demo, lang);
    const r = await createReview(db, "manager", { workId: s.workId, verdict: "returned", reason: "wrong" });
    const after = await readLedger(db, "manager", lang);
    expect(after).toHaveLength(before.length + 4);
    expect(after.slice(0, 4).map((e) => e.id)).toEqual([`autoReset:${r.id}`, `returned:${r.id}`, `submitted:${s.workId}`, `assigned:${a.id}`]);
    expect(after[0]).toMatchObject({ actor: null, employee: { id: "juniper" }, workTypeId: "ui", assignment: { id: a.id, title: "Ledger flow" } });
    expect(after[1]).toMatchObject({ kind: "returned", reason: "wrong", actor: "manager" });
    expect(after[2]).toMatchObject({ kind: "submitted", round: 1, actor: "juniper" });
    expect(after[3]).toMatchObject({ kind: "assigned", actor: "manager", assignment: { repoFullName: "example-org/lantern-notes" } });
    // staff 同樣看得到青翼專案的這四筆
    expect((await readLedger(db, "staff", lang)).slice(0, 4).map((e) => e.id)).toEqual(after.slice(0, 4).map((e) => e.id));
  });

  it("manager 對 Basil × 文件同意少看：manager 看得到，staff 看不到（#40 的 `## 決定` 1）", async () => {
    const staffBefore = await readLedger(db, "staff", lang);
    const d = await createLevelDecision(db, "manager", { employeeId: "basil", workTypeId: "docs", decision: "relax" });
    const manager = await readLedger(db, "manager", lang);
    expect(manager.find((e) => e.id === `relax:${d.id}`)).toMatchObject({ employee: { id: "basil" }, workTypeId: "docs", actor: "manager", assignment: null });
    const staff = await readLedger(db, "staff", lang);
    expect(staff.some((e) => e.id === `relax:${d.id}`)).toBe(false);
    expect(staff).toHaveLength(staffBefore.length);
  });
});
