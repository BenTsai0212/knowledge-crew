// 「員工」的資料整理（#37）：以匯入虛構資料後的資料庫，檢查三種身分看到的員工與每類工作的層級、驗收次數。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { getTrustInputs } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import type { DemoFile } from "../demo/types";
import { closedSummary, guidelineSummary } from "./EmployeeGuidelines";
import { groupEmployees, readEmployees, type EmployeeGuideline } from "./employees";
import { sourceLabel } from "./refs";

const lang = clientConfig.client.defaultLanguage;
const shape = (list: Awaited<ReturnType<typeof readEmployees>>) =>
  list.map((e) => [e.id, e.workTypes.map((w) => [w.workTypeId, w.level])]);
const reviewCount = async (identity: string, employeeId: string, workTypeId: string) =>
  (await getTrustInputs(db, identity, employeeId, workTypeId)).reviews.length;

// 員工本身沒有專案（guest 以外都看得到），工作類型只列出看得到交辦的組合（groupEmployees）
const STAFF_EMPLOYEES = [
  ["juniper", []],
  ["linden", []],
  ["rowan", ["support"]],
  ["sorrel", ["content"]],
];

const demo = (id: string) => (DEMO_RAW as DemoFile).guidelines!.find((g) => g.id === id)!;

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("readEmployees：匯入虛構資料後", () => {
  it("manager：四位員工各一類工作（Linden 看重點、其他逐項看），附名稱、說明與驗收次數", async () => {
    const list = await readEmployees(db, "manager", lang);
    expect(shape(list)).toEqual([
      ["juniper", [["dev", "item"]]],
      ["linden", [["knowledge", "light"]]],
      ["rowan", [["support", "item"]]],
      ["sorrel", [["content", "item"]]],
    ]);
    expect(list.map((e) => e.displayName)).toEqual(["Juniper", "Linden", "Rowan", "Sorrel"]);
    expect(list.every((e) => e.roleNote)).toBe(true);
    expect(list[0].workTypes[0].reviewCount).toBe(await reviewCount("manager", "juniper", "dev"));
    expect(list[1].workTypes[0].reviewCount).toBe(await reviewCount("manager", "linden", "knowledge"));
    expect(list[1].workTypes[0].reviewCount).toBeGreaterThan(0);
  });

  it("staff：只有青翼專案的 Rowan × 客戶回覆、Sorrel × 貼文與商品介紹；長堤專案的 Linden、Juniper 沒有看得到的工作", async () => {
    const list = await readEmployees(db, "staff", lang);
    expect(list.map((e) => [e.id, e.workTypes.map((w) => w.workTypeId)])).toEqual(STAFF_EMPLOYEES);
    const rowan = list.find((e) => e.id === "rowan")!;
    expect(rowan.workTypes[0].reviewCount).toBe(await reviewCount("staff", "rowan", "support"));
    expect(list.flatMap((e) => e.workTypes.map((w) => w.workTypeId))).toEqual(["support", "content"]);
  });

  it("guest（看得到員工、看不到交辦）與沒有身分：空的，不拋錯", async () => {
    expect(await readEmployees(db, "guest", lang)).toEqual([]);
    expect(await readEmployees(db, null, lang)).toEqual([]);
  });
});

describe("readEmployees：員工卡（#83）", () => {
  it("manager：交件來源、待驗收件數、最近 10 次圓點與一句說明（Sorrel 有看重點的建議、Rowan 做錯了、Linden 同意改看重點、Juniper 收回看重點）", async () => {
    const list = await readEmployees(db, "manager", lang, true);
    const work = (id: string) => list.find((e) => e.id === id)!.workTypes[0];
    expect(work("rowan").source).toEqual({ label: sourceLabel("support-inbox", "Support inbox", lang), kind: "mailbox" });
    expect(work("juniper").source?.kind).toBe("repo");
    // #134 加了待驗收的 j11（Juniper）、c12（Sorrel）
    expect(list.map((e) => e.workTypes[0].awaiting)).toEqual([2, 1, 1, 2]);
    expect(work("rowan").dots).toHaveLength(10);
    expect(work("rowan").dots.filter((d) => d === "wrong")).toHaveLength(1);
    expect(work("juniper").dots).toHaveLength(10);
    expect(work("sorrel").note).toEqual({ kind: "suggestion" });
    expect(work("rowan").note).toMatchObject({ kind: "event", event: { kind: "reset" } });
    expect(work("linden").note).toMatchObject({ kind: "event", event: { kind: "relax" } });
    expect(work("juniper").note).toEqual({ kind: "event", event: { kind: "revoke", at: "2026-10-24T02:00:00.000Z" } });
  });

  it("不能驗收時沒有看重點的建議", async () => {
    const list = await readEmployees(db, "manager", lang, false);
    expect(list.find((e) => e.id === "sorrel")!.workTypes[0].note).toBeNull();
  });
});

describe("groupEmployees", () => {
  const fern = { id: "fern", displayName: "Fern", roleNote: null };
  const basil = { id: "basil", displayName: "Basil", roleNote: null };
  const reset = { kind: "reset" as const, at: "2026-10-15T00:00:00Z" };
  const docs = {
    employee: basil,
    workTypeId: "docs",
    dots: ["ok" as const],
    level: "item" as const,
    reviewCount: 1,
    lastReset: null,
    suggestion: null,
    timeline: { cells: [], empty: 0, events: [{ column: 0, items: [{ kind: "relax" as const, at: "2026-10-13T00:00:00Z" }, reset] }] },
    note: null,
  };
  const assignment = (sourceId: string, latestRound: number | null, latestVerdict: "accepted" | null, workTypeId = "docs") => ({
    employeeId: "basil",
    workTypeId,
    sourceId,
    sourceKind: "mailbox" as const,
    sourceName: sourceId,
    latestRound,
    latestVerdict,
  });

  it("沒有看得到的組合的員工也列出，workTypes 為空；完全沒有組合時是空的", () => {
    expect(groupEmployees({ employees: [basil, fern], rows: [docs] }, [], lang)).toEqual([
      { ...basil, workTypes: [{ workTypeId: "docs", level: "item", reviewCount: 1, dots: ["ok"], awaiting: 0, source: null, note: { kind: "event", event: reset } }] },
      { ...fern, workTypes: [] },
    ]);
    expect(groupEmployees({ employees: [fern], rows: [] }, [], lang)).toEqual([]);
  });

  it("來源是同一工作類型最常用的；待驗收只算已交件、還沒驗收的；有建議時說明是建議", () => {
    const list = [assignment("a", 1, null), assignment("b", null, null), assignment("b", 2, "accepted"), assignment("c", 1, null, "other")];
    const [{ workTypes }] = groupEmployees({ employees: [basil], rows: [{ ...docs, suggestion: { count: 10, basisReviewId: "r", basisReviewIds: ["r"] } }] }, list, lang);
    expect(workTypes[0].source).toEqual({ label: "b", kind: "mailbox" });
    expect(workTypes[0].awaiting).toBe(1);
    expect(workTypes[0].note).toEqual({ kind: "suggestion" });
  });
});

describe("readEmployees：守則（#145）", () => {
  const ids = (g: { id: string }[]) => g.map((x) => x.id);
  const guidelinesOf = (list: Awaited<ReturnType<typeof readEmployees>>, id: string) => list.find((e) => e.id === id)!.guidelines;

  it("manager：等確認、生效、已收回與不採用分開；文字、來歷的日期與之後依照的次數", async () => {
    const list = await readEmployees(db, "manager", lang, true);
    const rowan = guidelinesOf(list, "rowan");
    expect([ids(rowan.pending), ids(rowan.active), ids(rowan.closed)]).toEqual([["g02"], ["g01"], []]);
    const g01 = rowan.active[0];
    expect(g01).toMatchObject({ proposerKind: "human", status: "active", revised: false, followed: 10, sourceAssignmentId: "s05", closedAt: null });
    expect(g01.text).toBe(demo("g01").text[lang]);
    expect(g01.confirmedAt).toBe(g01.proposedAt);
    const g02 = rowan.pending[0];
    expect(g02).toMatchObject({ proposerKind: "employee", confirmedAt: null, followed: 0, sourceAssignmentId: "s12" });
    // 員工提的守則，來歷是那次退回的日期
    expect(Date.parse(g02.returnedAt)).toBeLessThan(Date.parse(g02.proposedAt));

    const linden = guidelinesOf(list, "linden");
    expect([ids(linden.pending), ids(linden.active), ids(linden.closed)]).toEqual([[], ["g05"], ["g04"]]);
    expect(linden.active[0]).toMatchObject({ revised: true, followed: 7, text: demo("g05").decisions[0].revisedText![lang], proposedText: demo("g05").text[lang] });
    expect(linden.closed[0]).toMatchObject({ status: "revoked", closedAt: "2026-10-20T02:00:00.000Z" });
    expect(guidelinesOf(list, "juniper").closed.map((g) => [g.id, g.status])).toEqual([["g06", "rejected"]]);
    expect(ids(guidelinesOf(list, "sorrel").active)).toEqual(["g03"]);
  });

  it("文字依目前語言", async () => {
    const other = lang === "en" ? "zh-TW" : "en";
    const list = await readEmployees(db, "manager", other, true);
    expect(guidelinesOf(list, "rowan").pending[0].text).toBe(demo("g02").text[other]);
  });

  it("staff：只看得到青翼專案的 Rowan、Sorrel 的守則（可見範圍由資料庫決定）", async () => {
    const list = await readEmployees(db, "staff", lang);
    const all = (id: string) => {
      const g = guidelinesOf(list, id);
      return [...g.pending, ...g.active, ...g.closed].map((x) => x.id);
    };
    expect(["rowan", "sorrel", "linden", "juniper"].map(all)).toEqual([["g02", "g01"], ["g03"], [], []]);
  });
});

describe("guidelineSummary、closedSummary", () => {
  const g = (status: "pending" | "active" | "rejected" | "revoked") => ({ status }) as EmployeeGuideline;

  it("0 的那段不顯示；都沒有時是「還沒有守則」；不能驗收的身分是「等確認」", () => {
    expect(guidelineSummary({ active: [g("active"), g("active")], pending: [g("pending")] }, true, "zh-TW")).toBe("守則 2 條・等你確認 1 條");
    expect(guidelineSummary({ active: [g("active")], pending: [] }, true, "zh-TW")).toBe("守則 1 條");
    expect(guidelineSummary({ active: [], pending: [g("pending")] }, true, "zh-TW")).toBe("等你確認 1 條");
    expect(guidelineSummary({ active: [], pending: [g("pending")] }, false, "zh-TW")).toBe("等確認 1 條");
    expect(guidelineSummary({ active: [], pending: [] }, true, "zh-TW")).toBe("還沒有守則");
    expect(guidelineSummary({ active: [g("active")], pending: [g("pending")] }, true, "en")).toBe("1 guideline · 1 for you to confirm");
  });

  it("已收回與不採用", () => {
    expect(closedSummary([g("revoked"), g("rejected"), g("revoked")], "zh-TW")).toBe("已收回 2 條・不採用 1 條");
    expect(closedSummary([g("rejected")], "zh-TW")).toBe("不採用 1 條");
    expect(closedSummary([g("revoked")], "en")).toBe("1 retired");
  });
});
