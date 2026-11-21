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

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("readEmployees：匯入虛構資料後", () => {
  it("manager：Basil（文件、測試 逐項看）與 Juniper（介面 少看），附名稱、說明與驗收次數", async () => {
    const list = await readEmployees(db, "manager", lang);
    expect(shape(list)).toEqual([
      ["basil", [["docs", "item"], ["test", "item"]]],
      ["juniper", [["ui", "light"]]],
    ]);
    expect(list.map((e) => e.displayName)).toEqual(["Basil", "Juniper"]);
    expect(list.every((e) => e.roleNote)).toBe(true);
    expect(list[0].workTypes[0].reviewCount).toBe(await reviewCount("manager", "basil", "docs"));
    expect(list[1].workTypes[0].reviewCount).toBe(await reviewCount("manager", "juniper", "ui"));
    expect(list[1].workTypes[0].reviewCount).toBeGreaterThan(0);
  });

  it("staff：兩位員工，但只有青翼專案的 Juniper × 介面、Basil × 測試", async () => {
    const list = await readEmployees(db, "staff", lang);
    expect(list.map((e) => [e.id, e.workTypes.map((w) => w.workTypeId)])).toEqual([
      ["basil", ["test"]],
      ["juniper", ["ui"]],
    ]);
    expect(list[0].workTypes[0].reviewCount).toBe(await reviewCount("staff", "basil", "test"));
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
