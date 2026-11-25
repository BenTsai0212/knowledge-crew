// 首頁的「今天的工作」（#96）：分組、總結、每列的狀態與點了到哪裡。以匯入虛構資料後的資料庫檢查三種身分。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { awaitingCount, DECIDE_TARGET, guidelineTarget, homeSummary, homeToday, isHomeTodayEmpty, rowStatus, rowTarget } from "./home-today";
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
const today = (over: Partial<Today>): Today => ({ canReview: true, awaitingReview: [], inProgress: [], suggestions: [], guidelines: [], ...over });

describe("homeToday：匯入虛構資料後", () => {
  it("manager：有檢查沒通過的排在「先處理」，其餘待驗收、一個看重點的建議", async () => {
    const t = await read("manager");
    const h = homeToday(t);
    // 設計規格 v3 第 6.1 節的例子：Rowan（報價核對）、Linden（必填欄位）先處理
    expect(h.failing.map((a) => a.id)).toEqual(["s14", "k13"]);
    // #134 加了待驗收的 c12、j11，與進行中的 k14、k15、s16、s15（還沒交件或退回後等下一輪，依交辦時間舊到新）
    expect(h.awaiting.map((a) => a.id).sort()).toEqual(["c11", "c12", "j06", "j11"]);
    expect(h.decide.map((d) => d.employee.id)).toEqual(["sorrel"]);
    expect(h.inProgress.map((a) => a.id)).toEqual(["k14", "k15", "s16", "s15"]);
    expect(awaitingCount(t)).toBe(6);
    // #145：Rowan 整理的一條守則等確認
    expect(h.guidelines.map((g) => [g.id, g.employee.id, g.workTypeId])).toEqual([["g02", "rowan", "support"]]);
    expect(homeSummary(h, "zh-TW")).toBe("6 件工作等你驗收，其中 2 件有檢查沒通過；1 個「看重點」建議等你決定；1 條守則等你確認。");
    expect(homeSummary(h, "en")).toBe(
      "6 work items await your review, 2 with failed checks; 1 key-points suggestion awaits your decision; 1 guideline awaits your confirmation.",
    );
  });

  it("staff：只看得到自己專案的待驗收，沒有看重點的建議與側欄件數，總結用中性說法", async () => {
    const t = await read("staff");
    const h = homeToday(t);
    // #134 加了青翼專案待驗收的 c12
    expect([...h.failing, ...h.awaiting].map((a) => a.id).sort()).toEqual(["c11", "c12", "s14"]);
    expect(h.decide).toEqual([]);
    // 等確認的守則只給能驗收的身分（#145）
    expect(t.guidelines).toEqual([]);
    expect(h.guidelines).toEqual([]);
    expect(awaitingCount(t)).toBeNull();
    expect(homeSummary(h, "zh-TW")).toBe("3 件工作待驗收，其中 1 件有檢查沒通過。");
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

  it("待驗收與退回的到「工作與驗收」該件，還沒交件的到「交辦」，看重點的建議到「信任」", () => {
    expect(rowTarget(item({ id: "x" }), true)).toEqual({ section: "works", assignmentId: "x" });
    expect(rowTarget(item({ id: "x", returned: true }), false)).toEqual({ section: "works", assignmentId: "x" });
    expect(rowTarget(item({}), false)).toEqual({ section: "assignments" });
    expect(DECIDE_TARGET).toEqual({ section: "trust" });
  });

  it("等確認的守則到「員工」並帶員工（捲到該員工卡，#145）", () => {
    expect(guidelineTarget({ id: "g", employee: item({}).employee, workTypeId: "dev" })).toEqual({ section: "employees", employeeId: "e" });
  });

  it("總結：守則一句（#145）；不能驗收的身分沒有", () => {
    const g = { id: "g", employee: item({}).employee, workTypeId: "dev" };
    expect(homeSummary(homeToday(today({ guidelines: [g, { ...g, id: "g2" }] })), "zh-TW")).toBe("2 條守則等你確認。");
    expect(homeSummary(homeToday(today({ guidelines: [g] })), "en")).toBe("1 guideline awaits your confirmation.");
    const others = homeToday(today({ canReview: false, guidelines: [g] }));
    expect(others.guidelines).toEqual([]);
    expect(isHomeTodayEmpty(others)).toBe(true);
  });

  it("總結：只有進行中時提一句；不能驗收的身分沒有看重點的建議", () => {
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

describe("HomeTodayCard：每列的員工後面是工作類型（#100）", () => {
  it("manager：Rowan 的 s14 顯示「Rowan・客戶回覆」，每一列都有工作類型", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { HomeTodayCard } = await import("./HomeToday");
    const { workTypeLabel } = await import("./labels");
    const data = homeToday(await read("manager"));
    for (const phone of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(HomeTodayCard, { state: { identity: "manager", data, awaiting: 6 }, identity: "manager", language: "zh-TW", phone, onOpen: () => {} }),
      );
      expect(html).toContain(`Rowan</span>・${workTypeLabel("support", "zh-TW")}`);
      // #134 之後 demo 有進行中的交辦，進行中的列同樣帶工作類型
      const rows = [...data.failing, ...data.awaiting, ...data.inProgress];
      expect(html.match(/class="crew-home__employee"/g)).toHaveLength(rows.length);
      for (const a of rows) expect(html).toContain(`${a.employee.displayName}</span>・${workTypeLabel(a.workTypeId, "zh-TW")}`);
    }
  });
});

describe("HomeTodayCard：等確認的守則（#145）", () => {
  it("manager：「等你決定」有 Rowan 整理的「客戶回覆」守則一列與小字", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { HomeTodayCard } = await import("./HomeToday");
    const { workTypeLabel } = await import("./labels");
    const { crewStrings } = await import("../i18n");
    const t = crewStrings("home", "zh-TW");
    const data = homeToday(await read("manager"));
    const html = renderToStaticMarkup(
      createElement(HomeTodayCard, { state: { identity: "manager", data, awaiting: 6 }, identity: "manager", language: "zh-TW", phone: false, onOpen: () => {} }),
    );
    expect(html).toContain(`Rowan</span> 整理了一條「${workTypeLabel("support", "zh-TW")}」守則，等你確認`);
    expect(html).toContain(t.guidelineNote);
    expect(html).toContain(`aria-label="${t.actionGuideline}：Rowan"`);
  });
});
