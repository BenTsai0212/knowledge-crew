// 「工作與驗收」的資料整理（#39）：以匯入虛構資料後的資料庫，檢查三種身分的清單與面板、換語言、寫入後讀回。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { createAssignment, createReview, createWork, nextExternalRef } from "../db/store";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import type { DemoFile } from "../demo/types";
import { initialSelection, readReviewPanel, readWorkList, RECENT_LIMIT } from "./review";
import { canReviewOf } from "./today";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;
const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
const list = (db: Database, identity: string | null, language = lang) => readWorkList(db, identity, language);
const panel = (db: Database, identity: string | null, id: string, language = lang) =>
  readReviewPanel(db, identity, language, id, canReviewOf(clientConfig.access, identity));
const ids = (items: { id: string }[]) => items.map((i) => i.id);

// 來源的顯示名稱（#60 的 `## 決定` 2）
const label = (id: string, language = lang) => {
  const s = demo.sources.find((x) => x.id === id)!;
  return s.label?.[language] ?? s.name;
};
// 待驗收：依交件時間（s14 11-17、c11 與 k13 11-18、j06 11-19）
const AWAITING = ["s14", "c11", "k13", "j06"];
// k13 的檢查：format 先 pending 後 pass（同名只取最新一筆）、required-fields 是 fail；依名稱排序
const K13_CHECKS = [
  { name: "duplicates", status: "pass" },
  { name: "format", status: "pass" },
  { name: "required-fields", status: "fail" },
];

// 每個測試開自己的資料庫（套用全部 migration 並匯入虛構資料），接近 Vitest 預設的 5 秒（seed.test.ts 的 DB_TIMEOUT，PR #47）
const DB_TIMEOUT = 20_000;

let db: Database;
beforeAll(async () => {
  db = await open();
});
afterAll(() => db.close());

describe("readWorkList：匯入虛構資料後", () => {
  it("manager：待驗收是 s14、c11、k13、j06；最近驗收過依驗收時間新到舊，最多 RECENT_LIMIT 筆", async () => {
    const { awaiting, recent } = await list(db, "manager");
    expect(ids(awaiting)).toEqual(AWAITING);
    expect(recent).toHaveLength(RECENT_LIMIT);
    // c10 與 k12 的驗收時間相同，依交辦 id
    expect(ids(recent).slice(0, 3)).toEqual(["c10", "k12", "s13"]);
    expect(recent.every((i) => i.verdict === "accepted")).toBe(true);
    expect(awaiting[0]).toEqual({
      id: "s14",
      title: demo.assignments.find((a) => a.id === "s14")!.title[lang],
      sourceKind: "mailbox",
      sourceName: label("support-inbox"),
      externalRef: "1054",
      workRef: null,
      employee: { id: "rowan", displayName: "Rowan" },
      workTypeId: "support",
      round: 1,
      verdict: null,
    });
    expect(awaiting.find((a) => a.id === "j06")).toMatchObject({ sourceName: "example-org/company-site", externalRef: "26", workRef: "38", workTypeId: "dev" });
    expect(awaiting.find((a) => a.id === "c11")).toMatchObject({ sourceKind: "social", sourceName: label("social-account"), externalRef: null, workRef: null });
  });

  it("多輪的交辦顯示最新一輪的輪次與 PR 編號", async () => {
    const j04 = (await panel(db, "manager", "j04"))!.item;
    expect(j04).toMatchObject({ round: 2, workRef: "36", verdict: "accepted" });
  });

  it("staff：只看到青翼專案（客服信箱、官方社群帳號），待驗收只有 s14、c11", async () => {
    const { awaiting, recent } = await list(db, "staff");
    expect(ids(awaiting)).toEqual(["s14", "c11"]);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((i) => [label("support-inbox"), label("social-account")].includes(i.sourceName))).toBe(true);
  });

  it("guest 與沒有身分：兩組都是空的，不拋錯", async () => {
    expect(await list(db, "guest")).toEqual({ awaiting: [], recent: [] });
    expect(await list(db, null)).toEqual({ awaiting: [], recent: [] });
  });

  it("initialSelection：待驗收的第一筆；沒有待驗收時不選取", async () => {
    expect(initialSelection(await list(db, "manager"))).toBe("s14");
    expect(initialSelection(await list(db, "guest"))).toBeNull();
    expect(initialSelection({ awaiting: [], recent: (await list(db, "manager")).recent })).toBeNull();
  });
});

describe("readReviewPanel：匯入虛構資料後", () => {
  it("manager 打開 k13（Linden × 知識庫整理，少看）：變更收成摘要、全文收起、可以驗收", async () => {
    const p = (await panel(db, "manager", "k13"))!;
    expect(p.focus.level).toBe("light");
    expect(p.focus.points).toHaveLength(2);
    expect(p.focus.noPoints).toBe(false);
    expect(p.focus.changes).toEqual({ mode: "summary", count: 2 });
    expect(p.focus.body.collapsed).toBe(true);
    // 同名檢查只取最新一筆
    expect(p.focus.checks).toEqual(K13_CHECKS);
    expect(p.current).toMatchObject({ id: "k13-w1", round: 1, externalRef: null });
    expect(p.earlier).toEqual([]);
    expect(p.canDecide).toBe(true);
  });

  it("manager 打開 c11（Sorrel × 貼文與商品介紹，逐項看）：變更逐項列出", async () => {
    const p = (await panel(db, "manager", "c11"))!;
    expect(p.focus.level).toBe("item");
    expect(p.focus.changes.mode).toBe("items");
    expect(p.focus.changes.mode === "items" && p.focus.changes.items).toHaveLength(3);
    expect(p.canDecide).toBe(true);
  });

  it("前幾輪與其驗收結果：s12 的第 1 輪退回「做錯了」；已驗收的工作不能再驗收", async () => {
    const p = (await panel(db, "manager", "s12"))!;
    expect(p.earlier).toHaveLength(1);
    expect(p.earlier[0]).toMatchObject({ round: 1, externalRef: null, review: { verdict: "returned", reason: "wrong", note: null } });
    expect(p.current.round).toBe(2);
    expect(p.canDecide).toBe(false);
  });

  it("staff 打開 c11：內容同 manager 但不能驗收；k13 看不到", async () => {
    const [m, s] = [(await panel(db, "manager", "c11"))!, (await panel(db, "staff", "c11"))!];
    expect(s.focus).toEqual(m.focus);
    expect(s.canDecide).toBe(false);
    expect(await panel(db, "staff", "k13")).toBeNull();
  });

  it("guest、沒有身分與不存在的交辦：null", async () => {
    expect(await panel(db, "guest", "c11")).toBeNull();
    expect(await panel(db, null, "c11")).toBeNull();
    expect(await panel(db, "manager", "nope")).toBeNull();
  });

  it("標題、摘要、重點、變更說明與全文依目前語言顯示", async () => {
    const w = demo.assignments.find((a) => a.id === "k13")!.works[0];
    for (const language of [lang, other]) {
      const p = (await panel(db, "manager", "k13", language))!;
      expect(p.item.title).toBe(demo.assignments.find((a) => a.id === "k13")!.title[language]);
      expect(p.item.sourceName).toBe(label("company-kb", language));
      expect(p.current.summary).toBe(w.summary[language]);
      expect(p.focus.points).toEqual(w.points.map((t) => t[language]));
      expect(p.focus.body.text).toBe(w.body[language]);
      const c11 = (await panel(db, "manager", "c11", language))!;
      const cw = demo.assignments.find((a) => a.id === "c11")!.works[0];
      expect(c11.focus.changes).toEqual({ mode: "items", items: cw.changes.map((c) => ({ path: c.path, summary: c.summary[language] })) });
    }
  });
});

describe("寫入後讀回", { timeout: DB_TIMEOUT }, () => {
  it("人新增的工作：找不到翻譯時顯示原文；沒有重點時即使少看也逐項列出", async () => {
    const own = await open();
    try {
      const { id } = await createAssignment(own, "manager", { sourceId: "company-kb", title: "Own task", workTypeId: "knowledge", employeeId: "linden" });
      const externalRef = await nextExternalRef(own, "manager", "company-kb");
      const changes = [{ path: "a.ts", summary: "Change A" }];
      await createWork(own, "manager", { assignmentId: id, externalRef, summary: "Sum", body: "Body", points: [], changes, checks: [] });
      const p = (await panel(own, "manager", id, other))!;
      expect(p.item.title).toBe("Own task");
      expect(p.focus.body.text).toBe("Body");
      expect(p.focus.level).toBe("light");
      expect(p.focus.noPoints).toBe(true);
      expect(p.focus.changes).toEqual({ mode: "items", items: changes });
      expect(ids((await list(own, "manager")).awaiting)).toEqual([...AWAITING, id]);
    } finally {
      await own.close();
    }
  });

  it("manager 退回 k13（做錯了）：不再待驗收、移到最近驗收過的第一筆、Linden × 知識庫整理變回逐項看", async () => {
    const own = await open();
    try {
      await createReview(own, "manager", { workId: "k13-w1", verdict: "returned", reason: "wrong", note: "Check the owner" });
      const { awaiting, recent } = await list(own, "manager");
      expect(ids(awaiting)).toEqual(AWAITING.filter((x) => x !== "k13"));
      expect(recent[0]).toMatchObject({ id: "k13", verdict: "returned" });
      const p = (await panel(own, "manager", "k13"))!;
      expect(p.focus.level).toBe("item");
      expect(p.focus.changes.mode).toBe("items");
      expect(p.canDecide).toBe(false);
      expect(p.earlier).toEqual([]);
    } finally {
      await own.close();
    }
  });

  it("manager 通過 c11：不再待驗收、移到最近驗收過的第一筆", async () => {
    const own = await open();
    try {
      await createReview(own, "manager", { workId: "c11-w1", verdict: "accepted" });
      const { awaiting, recent } = await list(own, "manager");
      expect(ids(awaiting)).toEqual(AWAITING.filter((x) => x !== "c11"));
      expect(recent[0]).toMatchObject({ id: "c11", verdict: "accepted" });
      expect((await panel(own, "manager", "c11"))!.canDecide).toBe(false);
    } finally {
      await own.close();
    }
  });

  it("staff 與 guest 不能驗收，讀回後資料不變", async () => {
    const own = await open();
    try {
      const before = await list(own, "manager");
      for (const identity of ["staff", "guest"]) {
        await expect(createReview(own, identity, { workId: "s14-w1", verdict: "accepted" })).rejects.toThrow();
      }
      expect(await list(own, "manager")).toEqual(before);
    } finally {
      await own.close();
    }
  });
});
