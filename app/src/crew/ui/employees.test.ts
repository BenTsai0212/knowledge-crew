// 「員工」的資料整理（#37）：以匯入虛構資料後的資料庫，檢查三種身分看到的員工與每類工作的層級、驗收次數。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { getTrustInputs } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { groupEmployees, readEmployees } from "./employees";
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

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("readEmployees：匯入虛構資料後", () => {
  it("manager：四位員工各一類工作（Linden 少看、其他逐項看），附名稱、說明與驗收次數", async () => {
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
  it("manager：交件來源、待驗收件數、最近 10 次圓點與一句說明（Sorrel 有少看建議、Rowan 做錯了、Linden 同意少看、Juniper 收回少看）", async () => {
    const list = await readEmployees(db, "manager", lang, true);
    const work = (id: string) => list.find((e) => e.id === id)!.workTypes[0];
    expect(work("rowan").source).toEqual({ label: sourceLabel("support-inbox", "Support inbox", lang), kind: "mailbox" });
    expect(work("juniper").source?.kind).toBe("repo");
    expect(list.map((e) => e.workTypes[0].awaiting)).toEqual([1, 1, 1, 1]);
    expect(work("rowan").dots).toHaveLength(10);
    expect(work("rowan").dots.filter((d) => d === "wrong")).toHaveLength(1);
    expect(work("juniper").dots).toHaveLength(10);
    expect(work("sorrel").note).toEqual({ kind: "suggestion" });
    expect(work("rowan").note).toMatchObject({ kind: "event", event: { kind: "reset" } });
    expect(work("linden").note).toMatchObject({ kind: "event", event: { kind: "relax" } });
    expect(work("juniper").note).toEqual({ kind: "event", event: { kind: "revoke", at: "2026-10-24T02:00:00.000Z" } });
  });

  it("不能驗收時沒有少看建議", async () => {
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
