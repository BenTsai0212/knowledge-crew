// 「總覽」的資料整理（#134）：以匯入虛構資料後的資料庫，檢查三種身分的專案卡片、狀態與需注意的標記、篩選與看板的排序。
// demo 的今天固定（2026-11-20），狀態與標記不隨真實日期改變。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO, DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { crewStrings } from "../i18n";
import { WORK_STATUSES } from "../work/status";
import { OverviewView } from "./OverviewView";
import {
  activeGuidelineCounts,
  boardColumns,
  COLUMN_LIMIT,
  compareActive,
  DONE_LIMIT,
  filterItems,
  isFiltered,
  NO_FILTER,
  overviewOptions,
  readOverview,
  summarizeProjects,
  toOverviewItem,
  type Overview,
  type OverviewItem,
  type OverviewRow,
} from "./overview";
import { readWorkList, RECENT_LIMIT } from "./review";

const lang = clientConfig.client.defaultLanguage;
const read = (identity: string | null, language = lang) => readOverview(db, identity, language, clientConfig.access);
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);
const byStatus = (o: Overview) => Object.fromEntries(WORK_STATUSES.map((s) => [s, ids(o.items.filter((i) => i.status === s)).sort()]));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("readOverview：匯入虛構資料後", () => {
  it("demo 的今天固定是 2026-11-20", () => {
    expect(DEMO?.today).toBe("2026-11-20");
  });

  it("manager：兩個專案；四種狀態依交件與驗收推算", async () => {
    const o = await read("manager");
    // #161 加了已通過的 9 件與待驗收的 k17
    expect(o.items).toHaveLength(64);
    expect(byStatus(o)).toEqual({
      notSubmitted: ["k14", "s15"],
      awaiting: ["c11", "c12", "j06", "j11", "k13", "k17", "s14"],
      revising: ["k15", "s16"],
      done: expect.any(Array),
    });
    expect(byStatus(o).done).toHaveLength(53);
    const item = (id: string) => o.items.find((i) => i.id === id)!;
    // 修正中標出第幾輪退回；等驗收的 s14 有檢查沒通過（k13 也是），c11 的檢查還在進行
    expect(item("s16").round).toBe(1);
    expect(item("s15").round).toBeNull();
    expect(ids(o.items.filter((i) => i.checkFailed)).sort()).toEqual(["k13", "s14"]);
    // 已完成沒有停留天數，也不顯示相對期限（j05 的到期日 10-30 早於今天）
    expect(item("j05")).toMatchObject({ status: "done", stayDays: null, due: { kind: "none" }, flags: { overdue: false, soon: false, stalled: false } });
  });

  it("需注意的標記：逾期、3 天內到期與停滯在兩個專案都有", async () => {
    const o = await read("manager");
    const flagged = (flag: "overdue" | "soon" | "stalled") => ids(o.items.filter((i) => i.flags[flag])).sort();
    expect(flagged("overdue")).toEqual(["c12", "k14", "s14"]);
    expect(flagged("soon")).toEqual(["c11", "j11"]);
    expect(flagged("stalled")).toEqual(["c12", "j11", "k14"]);
    const item = (id: string) => o.items.find((i) => i.id === id)!;
    // 停留天數：c12 11-13 交件（7 天）、k14 11-12 交辦（8 天）、s14 11-17 交件（3 天，不算停滯）
    expect([item("c12").stayDays, item("k14").stayDays, item("s14").stayDays]).toEqual([7, 8, 3]);
  });

  it("manager：專案卡片（名稱、來源、進度、四種狀態、需注意的件數、回流知識的筆數）", async () => {
    const o = await read("manager");
    const t = (id: string) => clientConfig.access.projects.find((p) => p.id === id)!.label[lang];
    expect(o.projects.map((p) => p.id)).toEqual(["bluewing", "longpier"]);
    const [bluewing, longpier] = o.projects;
    expect(bluewing).toMatchObject({
      label: t("bluewing"),
      total: 32,
      counts: { notSubmitted: 1, awaiting: 3, revising: 1, done: 27 },
      attention: { overdue: 2, soon: 1, stalled: 1 },
      knowledge: 0,
    });
    expect(bluewing.sources).toHaveLength(2);
    expect(longpier).toMatchObject({
      label: t("longpier"),
      total: 32,
      counts: { notSubmitted: 1, awaiting: 4, revising: 1, done: 26 },
      attention: { overdue: 1, soon: 1, stalled: 2 },
    });
    expect(longpier.sources).toHaveLength(2);
    // 回流的只有知識庫條目格式的交件（k12 與 #161 改寫的 k01-2；其他已通過的知識庫交件是一行摘要）
    expect(longpier.knowledge).toBe(2);
  });

  it("staff：只看到自己專案（青翼）的卡片與工作", async () => {
    const o = await read("staff");
    expect(o.projects.map((p) => p.id)).toEqual(["bluewing"]);
    expect(o.items).toHaveLength(32);
    expect(new Set(o.items.map((i) => i.projectId))).toEqual(new Set(["bluewing"]));
  });

  it("guest 與沒有身分：沒有專案與工作", async () => {
    expect(await read("guest")).toEqual({ projects: [], items: [] });
    expect(await read(null)).toEqual({ projects: [], items: [] });
  });

  it("標題依語言（找不到翻譯時用原文）", async () => {
    for (const language of clientConfig.client.languages) {
      const o = await read("manager", language);
      expect(o.items.find((i) => i.id === "c12")!.title).toBe(DEMO!.assignments.find((a) => a.id === "c12")!.title[language]);
    }
  });
});

describe("守則 N 條（#153 第 7 點）", () => {
  it("manager：只算現在生效的守則，依來源交辦的專案分組（青翼 g01、g03；長堤 g05；g02 待確認、g04 已收回、g06 不採用不算）", async () => {
    const o = await read("manager");
    const count = (id: string) => o.projects.find((p) => p.id === id)!.guidelines;
    expect([count("bluewing"), count("longpier")]).toEqual([2, 1]);
    // 回流知識維持原本的算法（#161 的 k01-2 也回流）
    expect(o.projects.find((p) => p.id === "longpier")!.knowledge).toBe(2);
  });

  it("staff：只算看得到的專案", async () => {
    const o = await read("staff");
    expect(o.projects.map((p) => [p.id, p.guidelines])).toEqual([["bluewing", 2]]);
  });

  it("activeGuidelineCounts：等確認、不採用、已收回不算；確認後又收回不算；沒有生效的專案不出現（卡片顯示 0）", () => {
    const at = (d: string) => `2026-11-${d}T10:00:00+08:00`;
    const counts = activeGuidelineCounts([
      { id: "a", projectId: "p1", decision: "confirm", revisedText: null, decidedAt: at("01") },
      { id: "b", projectId: "p1", decision: null, revisedText: null, decidedAt: null },
      { id: "c", projectId: "p1", decision: "reject", revisedText: null, decidedAt: at("02") },
      { id: "d", projectId: "p2", decision: "confirm", revisedText: "x", decidedAt: at("01") },
      { id: "d", projectId: "p2", decision: "revoke", revisedText: null, decidedAt: at("03") },
      { id: "e", projectId: "p3", decision: "confirm", revisedText: null, decidedAt: new Date(at("04")) },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ p1: 1, p3: 1 });
    const [p] = summarizeProjects([{ id: "p2", label: "P", sources: [] }], [], new Map(), counts);
    expect(p.guidelines).toBe(0);
  });
});

describe("篩選與看板", () => {
  it("看板四欄的排序：逾期 → 優先順序高 → 到期日近 → 停留久；已完成是最近完成的在前", async () => {
    const columns = boardColumns((await read("manager")).items);
    expect(ids(columns.notSubmitted)).toEqual(["k14", "s15"]);
    // #161 的 k17：一般優先、12-02 到期，排在 c11（11-22）與 k13（12-04）之間
    expect(ids(columns.awaiting)).toEqual(["c12", "s14", "j06", "j11", "c11", "k17", "k13"]);
    expect(ids(columns.revising)).toEqual(["s16", "k15"]);
    const doneAt = columns.done.map((i) => i.doneAt!);
    expect(doneAt).toEqual([...doneAt].sort().reverse());
    expect(COLUMN_LIMIT).toBeGreaterThan(DONE_LIMIT);
  });

  it("專案、員工、工作類型與「只看需注意」可以疊加；清除後回到全部", async () => {
    const { items } = await read("manager");
    expect(filterItems(items, NO_FILTER)).toHaveLength(items.length);
    expect(isFiltered(NO_FILTER)).toBe(false);
    const longpier = { ...NO_FILTER, projectId: "longpier" };
    expect(filterItems(items, longpier)).toHaveLength(32);
    expect(ids(filterItems(items, { ...longpier, attentionOnly: true })).sort()).toEqual(["j11", "k14"]);
    expect(ids(filterItems(items, { ...NO_FILTER, employeeId: "sorrel", attentionOnly: true })).sort()).toEqual(["c11", "c12"]);
    expect(ids(filterItems(items, { ...NO_FILTER, workTypeId: "dev", attentionOnly: true }))).toEqual(["j11"]);
    expect(isFiltered({ ...NO_FILTER, attentionOnly: true })).toBe(true);
  });

  it("篩選列的選項：看板上出現過的員工與工作類型", async () => {
    const options = overviewOptions((await read("staff")).items);
    expect(options.employees.map((e) => e.id).sort()).toEqual(["rowan", "sorrel"]);
    expect(options.workTypes).toEqual(["content", "support"]);
  });

  it("沒有身分的資料列也能推算（純函式）：summarizeProjects 沒有工作的專案件數都是 0", () => {
    const row: OverviewRow = {
      id: "x1", title: "X", employeeId: "rowan", employeeName: "Rowan", workTypeId: "support", projectId: "bluewing",
      assignedAt: "2026-11-01T12:00:00Z", dueAt: "2026-11-21", priority: "high",
      latestRound: null, latestSubmittedAt: null, latestVerdict: null, latestDecidedAt: null, checkFailed: true,
    };
    const item = toOverviewItem(row, "2026-11-20");
    // 待交件沒有檢查：checkFailed 只在等驗收時標出
    expect(item).toMatchObject({ status: "notSubmitted", checkFailed: false, stayDays: 19, flags: { overdue: false, soon: true, stalled: true } });
    const [p] = summarizeProjects([{ id: "longpier", label: "L", sources: [] }], [item], new Map());
    expect(p).toMatchObject({ total: 0, counts: { notSubmitted: 0, awaiting: 0, revising: 0, done: 0 }, knowledge: 0, guidelines: 0 });
  });

  it("compareActive：同樣逾期時優先順序高的在前，其他相同時停留久的在前", () => {
    const base = toOverviewItem(
      {
        id: "a", title: "A", employeeId: "rowan", employeeName: "Rowan", workTypeId: "support", projectId: "bluewing",
        assignedAt: "2026-11-18T12:00:00Z", dueAt: null, priority: "normal",
        latestRound: null, latestSubmittedAt: null, latestVerdict: null, latestDecidedAt: null, checkFailed: false,
      },
      "2026-11-20",
    );
    const older: OverviewItem = { ...base, id: "b", stayDays: 5 };
    const high: OverviewItem = { ...base, id: "c", priority: "high" };
    expect([base, older, high].sort(compareActive).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("追到工作與驗收（#134）", () => {
  it("較早完成、不在最近驗收過的工作：pinned 時接在最後，可以選取", async () => {
    const { items } = await read("manager");
    const recent = ids((await readWorkList(db, "manager", lang)).recent);
    expect(recent).toHaveLength(RECENT_LIMIT);
    const old = items.find((i) => i.status === "done" && !recent.includes(i.id))!;
    const pinned = ids((await readWorkList(db, "manager", lang, undefined, old.id)).recent);
    expect(pinned).toEqual([...recent, old.id]);
    // 已在最近驗收過的、或還沒驗收的：清單不變
    expect(ids((await readWorkList(db, "manager", lang, undefined, recent[0])).recent)).toEqual(recent);
    expect(ids((await readWorkList(db, "manager", lang, undefined, "c12")).recent)).toEqual(recent);
  });
});

describe("OverviewView", () => {
  it("一開始顯示讀取中（伺服器端產生的 HTML 不讀資料庫）", () => {
    const html = renderToStaticMarkup(createElement(OverviewView, { db: {} as never, identity: "manager", language: lang }));
    expect(html).toContain(crewStrings("overview", lang).loading);
    expect(html).toContain(crewStrings("overview", lang).lead);
    // 子頁的主標題是 CrewPage 頁首的 h1（#179），畫面內沒有標題
    expect(html).not.toContain("<h2");
  });
});
