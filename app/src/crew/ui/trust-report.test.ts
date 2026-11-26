// 信任頁的總覽報表（#121）：匯入虛構資料後與工作帳本的事件一致、三種身分的結果，以及純函式的計數。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import type { ReturnReason } from "../trust/types";
import { filterLedger, readLedger, type LedgerEvent, type LedgerKind } from "./ledger";
import { canReviewOf } from "./today";
import { readTrust, type TrustRow } from "./trust";
import { firstPassPercent, trustReport, type TrustReportRow } from "./trust-report";

const lang = clientConfig.client.defaultLanguage;

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

async function read(identity: string | null) {
  const trust = await readTrust(db, identity, lang, canReviewOf(clientConfig.access, identity));
  const events = await readLedger(db, identity, lang);
  return { trust, events, report: trustReport(trust.rows, events) };
}

const find = (report: TrustReportRow[], employeeId: string, workTypeId: string) => {
  const found = report.find((r) => r.employee.id === employeeId && r.workTypeId === workTypeId);
  if (!found) throw new Error(`沒有 ${employeeId} × ${workTypeId}`);
  return found;
};

const REASONS: ReturnReason[] = ["wrong", "different_approach", "process"];

describe("trustReport：匯入虛構資料後", () => {
  it("manager：四列，順序與信任頁的卡片相同", async () => {
    const { trust, report } = await read("manager");
    expect(report.map((r) => [r.employee.id, r.workTypeId])).toEqual(trust.rows.map((r) => [r.employee.id, r.workTypeId]));
    expect(report).toHaveLength(4);
  });

  it("manager：每一列都與工作帳本的事件一致（驗收、三種退回、層級變化與最近一次）", async () => {
    const { trust, events, report } = await read("manager");
    for (const row of report) {
      const pair = { employeeId: row.employee.id, workTypeId: row.workTypeId };
      const all = filterLedger(events, pair);
      // 「只看退回」也含事後更正（#164），退回次數不算它
      const returned = filterLedger(events, { ...pair, event: "returned" }).filter((e) => e.kind === "returned");
      // 「只看層級改變」也含提出看重點的建議（#125），層級變化不算它
      const level = filterLedger(events, { ...pair, event: "level" }).filter((e) => e.kind !== "proposed");
      expect(row.reviews).toBe(all.filter((e) => e.kind === "accepted" || e.kind === "returned").length);
      expect(row.reviews).toBe(trust.rows.find((r) => r.employee.id === pair.employeeId && r.workTypeId === pair.workTypeId)!.reviewCount);
      for (const reason of REASONS) expect(row.returns[reason]).toBe(returned.filter((e) => e.reason === reason).length);
      expect(REASONS.reduce((sum, reason) => sum + row.returns[reason], 0)).toBe(returned.length);
      expect(row.levelChanges).toBe(level.length);
      expect(row.lastChange).toEqual(level[0] ? { kind: level[0].kind, at: level[0].at } : null);
    }
  });

  // #134 加了 s16-1（第 1 輪以不一樣的做法退回）；#161 加了 s17～s20（第一次就通過）
  it("manager：Rowan × 客戶回覆：20 次驗收、做錯了 1／不一樣的做法 2／流程 0，逐項看，層級變化 2 次、最近一次是自動改回", async () => {
    const row = find((await read("manager")).report, "rowan", "support");
    expect(row.reviews).toBe(20);
    expect(row.returns).toEqual({ wrong: 1, different_approach: 2, process: 0 });
    expect(row.level).toBe("item");
    expect(row.levelChanges).toBe(2);
    expect(row.lastChange).toEqual({ kind: "autoReset", at: "2026-10-15T07:00:00.000Z" });
    // #134 的 s16 第 1 輪退回：第一次就通過 11／14；#161 的 s17～s20 都是第一次就通過：15／18
    expect(row.firstPass).toEqual({ passed: 15, total: 18 });
    expect(firstPassPercent(row.firstPass)).toBe(83);
  });

  it("manager：Linden 是看重點、最近一次是同意改看重點；Sorrel 沒有層級變化、Juniper 同意後收回；三種退回原因分開計數", async () => {
    const { report } = await read("manager");
    const linden = find(report, "linden", "knowledge");
    expect(linden.level).toBe("light");
    expect(linden.lastChange).toEqual({ kind: "relax", at: "2026-10-13T02:00:00.000Z" });
    expect(find(report, "sorrel", "content")).toMatchObject({ reviews: 12, levelChanges: 0, lastChange: null, returns: { wrong: 1, different_approach: 0, process: 1 } });
    expect(find(report, "juniper", "dev")).toMatchObject({
      reviews: 15,
      levelChanges: 2,
      lastChange: { kind: "revoke", at: "2026-11-10T02:00:00.000Z" },
      returns: { wrong: 0, different_approach: 1, process: 1 },
    });
  });

  // 抽查（#166）：s12-1 抽查時做錯了、j15 抽查通過；Linden 的 k17 抽查還沒驗收；Sorrel 沒有看重點過
  it("manager：抽查欄是已驗收的抽查次數與其中做錯了的次數；沒有時是 null", async () => {
    const { report } = await read("manager");
    expect(find(report, "rowan", "support").spot).toEqual({ count: 1, wrong: 1 });
    expect(find(report, "juniper", "dev").spot).toEqual({ count: 1, wrong: 0 });
    expect(find(report, "linden", "knowledge").spot).toBeNull();
    expect(find(report, "sorrel", "content").spot).toBeNull();
  });

  it("staff：只有自己專案看得到的兩列，數字與主管看到的相同", async () => {
    const staff = (await read("staff")).report;
    const manager = (await read("manager")).report;
    expect(staff.map((r) => [r.employee.id, r.workTypeId])).toEqual([["rowan", "support"], ["sorrel", "content"]]);
    for (const row of staff) expect(row).toEqual(find(manager, row.employee.id, row.workTypeId));
  });

  it("guest 與沒有身分：沒有列", async () => {
    expect((await read("guest")).report).toEqual([]);
    expect((await read(null)).report).toEqual([]);
  });
});

describe("trustReport／firstPassPercent（純函式）", () => {
  const trustRow = (employeeId: string, workTypeId: string, spotChecks: TrustRow["spotChecks"] = { total: 0, accepted: 0, wrong: 0, other: 0 }): TrustRow => ({
    employee: { id: employeeId, displayName: employeeId, roleNote: null },
    workTypeId,
    dots: [],
    dotCorrections: [],
    level: "item",
    reviewCount: 0,
    lastReset: null,
    suggestion: null,
    timeline: { cells: [], empty: 0, events: [] },
    note: null,
    spotChecks,
  });
  const event = (
    kind: LedgerKind,
    at: string,
    extra: Partial<Pick<LedgerEvent, "round" | "reason">> & { assignmentId?: string; employeeId?: string; workTypeId?: string } = {},
  ): LedgerEvent => ({
    id: `${kind}:${at}`,
    kind,
    at,
    employee: { id: extra.employeeId ?? "basil", displayName: "Basil" },
    workTypeId: extra.workTypeId ?? "docs",
    assignment: extra.assignmentId
      ? { id: extra.assignmentId, title: extra.assignmentId, sourceKind: "repo", sourceName: "r", externalRef: null }
      : null,
    actor: null,
    round: extra.round ?? null,
    reason: extra.reason ?? null,
  });

  it("第一次就通過只看第 1 輪；之後的輪次通過不算；其他組合的事件不算", () => {
    const events = [
      // 新到舊
      event("accepted", "2026-10-05T00:00:00.000Z", { assignmentId: "a2", round: 2 }),
      event("returned", "2026-10-04T00:00:00.000Z", { assignmentId: "a2", round: 1, reason: "process" }),
      event("accepted", "2026-10-03T00:00:00.000Z", { assignmentId: "a1", round: 1 }),
      event("submitted", "2026-10-02T00:00:00.000Z", { assignmentId: "a3", round: 1 }),
      event("accepted", "2026-10-01T00:00:00.000Z", { assignmentId: "x1", round: 1, employeeId: "other" }),
    ];
    const [row] = trustReport([trustRow("basil", "docs")], events);
    expect(row.reviews).toBe(3);
    expect(row.firstPass).toEqual({ passed: 1, total: 2 });
    expect(row.returns).toEqual({ wrong: 0, different_approach: 0, process: 1 });
    expect(firstPassPercent(row.firstPass)).toBe(50);
  });

  it("層級變化：三種都算，最近一次是最新的那一筆", () => {
    const events = [
      event("revoke", "2026-10-03T00:00:00.000Z"),
      event("autoReset", "2026-10-02T00:00:00.000Z"),
      event("relax", "2026-10-01T00:00:00.000Z"),
    ];
    const [row] = trustReport([trustRow("basil", "docs")], events);
    expect(row.levelChanges).toBe(3);
    expect(row.lastChange).toEqual({ kind: "revoke", at: "2026-10-03T00:00:00.000Z" });
  });

  it("抽查欄只算已驗收的抽查（還沒驗收的不算），做錯了另外計數", () => {
    const [none] = trustReport([trustRow("basil", "docs", { total: 1, accepted: 0, wrong: 0, other: 0 })], []);
    expect(none.spot).toBeNull();
    const [some] = trustReport([trustRow("basil", "docs", { total: 5, accepted: 2, wrong: 1, other: 1 })], []);
    expect(some.spot).toEqual({ count: 4, wrong: 1 });
  });

  it("沒有事件：全部是 0，比例是 null", () => {
    const [row] = trustReport([trustRow("basil", "docs")], []);
    expect(row).toMatchObject({ reviews: 0, firstPass: { passed: 0, total: 0 }, levelChanges: 0, lastChange: null });
    expect(firstPassPercent(row.firstPass)).toBeNull();
  });
});
