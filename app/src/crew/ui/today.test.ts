// 今天的工作的資料整理（#34；首頁的「今天的工作」#96 使用）：以匯入虛構資料後的資料庫，檢查三種身分看到的三個區塊與換語言。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import type { DemoFile } from "../demo/types";
import { crewStrings } from "../i18n";
import { workTypeLabel } from "./labels";
import { canReviewOf, readToday } from "./today";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;
const read = (identity: string | null, language = lang) =>
  readToday(db, identity, language, canReviewOf(clientConfig.access, identity));

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("canReviewOf：依 client/access.json 的角色", () => {
  it("manager 能驗收，staff、guest 與沒有身分不能", () => {
    expect(canReviewOf(clientConfig.access, "manager")).toBe(true);
    expect(canReviewOf(clientConfig.access, "staff")).toBe(false);
    expect(canReviewOf(clientConfig.access, "guest")).toBe(false);
    expect(canReviewOf(clientConfig.access, null)).toBe(false);
  });
});

describe("readToday：匯入虛構資料後", () => {
  // #134 加了待驗收的 c12、j11，與進行中的 k14、s15（還沒交件）、k15、s16（退回後等下一輪）
  it("manager：待驗收 6（c12、j11、s14、c11、k13、j06）、進行中 4（k14、k15、s16、s15）、建議改看重點 1（Sorrel × 貼文與商品介紹）", async () => {
    const today = await read("manager");
    expect(today.canReview).toBe(true);
    expect(today.awaitingReview.map((a) => a.id).sort()).toEqual(["c11", "c12", "j06", "j11", "k13", "s14"]);
    expect(today.inProgress.map((a) => [a.id, a.returned])).toEqual([["k14", false], ["k15", true], ["s16", true], ["s15", false]]);
    expect(today.suggestions.map((s) => [s.employee.id, s.workTypeId])).toEqual([["sorrel", "content"]]);
    expect(today.suggestions[0].count).toBe(10);
  });

  // #134 加了青翼專案的 c12（待驗收）、s15、s16（進行中）
  it("staff：只看到青翼專案，待驗收 3（c11、c12、s14）、進行中 2（s16、s15）、不計算建議改看重點", async () => {
    const today = await read("staff");
    expect(today.canReview).toBe(false);
    expect(today.awaitingReview.map((a) => a.id).sort()).toEqual(["c11", "c12", "s14"]);
    // 來源名稱是目前語言的顯示名稱（#60 的 `## 決定` 2）
    const inbox = demo.sources.find((x) => x.id === "support-inbox")!;
    expect(today.awaitingReview.find((a) => a.id === "s14")!.sourceName).toBe(inbox.label![lang]);
    expect(today.inProgress.map((a) => [a.id, a.returned])).toEqual([["s16", true], ["s15", false]]);
    expect(today.suggestions).toEqual([]);
  });

  it("guest：三個區塊都是空的", async () => {
    const today = await read("guest");
    expect([...today.awaitingReview, ...today.inProgress, ...today.suggestions]).toEqual([]);
  });

  it("沒有身分時比照 guest，不拋錯", async () => {
    const today = await read(null);
    expect(today).toEqual({ canReview: false, awaitingReview: [], inProgress: [], suggestions: [] });
  });

  it("交辦標題、員工說明與來源名稱依目前語言顯示", async () => {
    const s14 = demo.assignments.find((a) => a.id === "s14")!;
    const rowan = demo.employees.find((e) => e.id === "rowan")!;
    const inbox = demo.sources.find((x) => x.id === "support-inbox")!;
    for (const language of [lang, other]) {
      const item = (await read("staff", language)).awaitingReview.find((a) => a.id === "s14")!;
      expect(item.title).toBe(s14.title[language]);
      expect(item.employee).toEqual({ id: "rowan", displayName: "Rowan", roleNote: rowan.roleNote[language] });
      expect(item.sourceName).toBe(inbox.label![language]);
    }
  });

  it("找不到目前語言的文字時顯示資料庫的原文", async () => {
    const item = (await read("staff", "xx")).awaitingReview.find((a) => a.id === "s14")!;
    expect(item.title).toBe(demo.assignments.find((a) => a.id === "s14")!.title[lang]);
    expect(item.employee.roleNote).toBe(demo.employees.find((e) => e.id === "rowan")!.roleNote[lang]);
    expect(item.sourceName).toBe("Support inbox");
  });
});

describe("crew 共用的文字", () => {
  it("「虛構資料」標示在 common（CrewPage 的頁首）", () => {
    for (const language of clientConfig.client.languages) {
      expect(crewStrings("common", language)).toHaveProperty("fictionalData");
    }
  });

  it("工作類型名稱來自 common；沒有的鍵顯示 id 本身", () => {
    expect(workTypeLabel("knowledge", "zh-TW")).toBe("知識庫整理");
    expect(workTypeLabel("dev", "en")).toBe("Site and tool changes");
    expect(workTypeLabel("design", "en")).toBe("design");
  });
});
