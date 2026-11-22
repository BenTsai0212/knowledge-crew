// 首頁的「今天的工作」（#96）：分組、總結、每列的狀態與點了到哪裡。以匯入虛構資料後的資料庫檢查三種身分。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { awaitingCount, DECIDE_TARGET, homeSummary, homeToday, isHomeTodayEmpty, rowStatus, rowTarget } from "./home-today";
import { canReviewOf, readToday, type Today, type TodayAssignment } from "./today";

const read = (identity: string) => readToday(db, identity, "zh-TW", canReviewOf(clientConfig.access, identity));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

const item = (over: Partial<TodayAssignment>): TodayAssignment => ({
  id: "a1",
  title: "標題",
  sourceKind: "repo",
  sourceName: "repo",
  externalRef: "1",
  workTypeId: "dev",
  employee: { id: "e", displayName: "E", roleNote: null },
  checks: [],
  returned: false,
  ...over,
});
const today = (over: Partial<Today>): Today => ({ canReview: true, awaitingReview: [], inProgress: [], suggestions: [], ...over });

describe("homeToday：匯入虛構資料後", () => {
  it("manager：有檢查沒通過的排在「先處理」，其餘待驗收、一個少看建議", async () => {
    const t = await read("manager");
    const h = homeToday(t);
    // 設計規格 v3 第 6.1 節的例子：Rowan（報價核對）、Linden（必填欄位）先處理
    expect(h.failing.map((a) => a.id)).toEqual(["s14", "k13"]);
    expect(h.awaiting.map((a) => a.id).sort()).toEqual(["c11", "j06"]);
    expect(h.decide.map((d) => d.employee.id)).toEqual(["sorrel"]);
    expect(h.inProgress).toEqual([]);
    expect(awaitingCount(t)).toBe(4);
    expect(homeSummary(h, "zh-TW")).toBe("4 件工作等你驗收，其中 2 件有檢查沒通過；1 個「少看」建議等你決定。");
    expect(homeSummary(h, "en")).toBe("4 work items await your review, 2 with failed checks; 1 lighter-review suggestion awaits your decision.");
  });

  it("staff：只看得到自己專案的待驗收，沒有少看建議與側欄件數，總結用中性說法", async () => {
    const t = await read("staff");
    const h = homeToday(t);
    expect([...h.failing, ...h.awaiting].map((a) => a.id).sort()).toEqual(["c11", "s14"]);
    expect(h.decide).toEqual([]);
    expect(awaitingCount(t)).toBeNull();
    expect(homeSummary(h, "zh-TW")).toBe("2 件工作待驗收，其中 1 件有檢查沒通過。");
  });

  it("guest：四組都是空的，沒有總結", async () => {
    const h = homeToday(await read("guest"));
    expect(isHomeTodayEmpty(h)).toBe(true);
    expect(homeSummary(h, "zh-TW")).toBeNull();
  });

  it("待驗收的列帶最新一輪的檢查：s14 的報價核對未通過", async () => {
    const s14 = homeToday(await read("manager")).failing[0];
    expect(rowStatus(s14, true, "zh-TW")).toMatch(/未通過$/);
    expect(rowStatus(s14, true, "zh-TW")).not.toMatch(/通過・|檢查中/);
  });
});

describe("rowStatus、rowTarget", () => {
  it("待驗收列出每個檢查；沒有檢查時說沒有", () => {
    const a = item({ checks: [{ name: "links", status: "pending" }, { name: "length", status: "pass" }] });
    expect(rowStatus(a, true, "zh-TW").split("・")).toHaveLength(2);
    expect(rowStatus(a, true, "zh-TW")).toMatch(/檢查中・.+通過$/);
    expect(rowStatus(item({}), true, "zh-TW")).toBe("沒有自動檢查");
  });

  it("進行中：還沒交件或退回後等下一輪", () => {
    expect(rowStatus(item({}), false, "zh-TW")).toBe("還沒交件");
    expect(rowStatus(item({ returned: true }), false, "zh-TW")).toBe("退回後等下一輪");
  });

  it("待驗收與退回的到「工作與驗收」該件，還沒交件的到「交辦」，少看建議到「信任」", () => {
    expect(rowTarget(item({ id: "x" }), true)).toEqual({ section: "works", assignmentId: "x" });
    expect(rowTarget(item({ id: "x", returned: true }), false)).toEqual({ section: "works", assignmentId: "x" });
    expect(rowTarget(item({}), false)).toEqual({ section: "assignments" });
    expect(DECIDE_TARGET).toEqual({ section: "trust" });
  });

  it("總結：只有進行中時提一句；不能驗收的身分沒有少看建議", () => {
    expect(homeSummary(homeToday(today({ inProgress: [item({})] })), "zh-TW")).toBe("1 件交辦進行中。");
    const others = homeToday(today({ canReview: false, suggestions: [{ employee: item({}).employee, workTypeId: "dev", count: 10 }] }));
    expect(others.decide).toEqual([]);
    expect(awaitingCount(today({ canReview: false, awaitingReview: [item({})] }))).toBeNull();
  });
});

describe("HomeTodayCard：沒有 AI 員工的客戶", () => {
  it("沒有資料時不讀 crew 的翻譯檔（沒有翻譯檔的語言也不拋錯），不輸出任何內容", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { HomeTodayCard, HomeTodaySummary } = await import("./HomeToday");
    const props = { state: null, identity: "manager", language: "xx", phone: false, onOpen: () => {} };
    expect(renderToStaticMarkup(createElement(HomeTodayCard, props))).toBe("");
    expect(renderToStaticMarkup(createElement(HomeTodaySummary, props))).toBe("");
  });
});
