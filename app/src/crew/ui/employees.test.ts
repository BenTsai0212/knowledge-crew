// 「員工」的資料整理（#37）：以匯入虛構資料後的資料庫，檢查三種身分看到的員工與每類工作的層級、驗收次數。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { getTrustInputs } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { groupEmployees, readEmployees } from "./employees";

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

describe("groupEmployees", () => {
  it("沒有看得到的組合的員工也列出，workTypes 為空；完全沒有組合時是空的", () => {
    const fern = { id: "fern", displayName: "Fern", roleNote: null };
    const basil = { id: "basil", displayName: "Basil", roleNote: null };
    const docs = { employee: basil, workTypeId: "docs", dots: [], level: "item" as const, reviewCount: 0, lastReset: null, suggestion: null };
    expect(groupEmployees({ employees: [basil, fern], rows: [docs] })).toEqual([
      { ...basil, workTypes: [{ workTypeId: "docs", level: "item", reviewCount: 0 }] },
      { ...fern, workTypes: [] },
    ]);
    expect(groupEmployees({ employees: [fern], rows: [] })).toEqual([]);
  });
});
