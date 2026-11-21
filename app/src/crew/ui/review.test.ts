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

let db: Database;
beforeAll(async () => {
  db = await open();
});
afterAll(() => db.close());

describe("readWorkList：匯入虛構資料後", () => {
  it("manager：待驗收是 j13、b11；最近驗收過依驗收時間新到舊，最多 RECENT_LIMIT 筆", async () => {
    const { awaiting, recent } = await list(db, "manager");
    expect(ids(awaiting)).toEqual(["j13", "b11"]);
    expect(recent).toHaveLength(RECENT_LIMIT);
    // b10 與 j12 的驗收時間相同，依交辦 id
    expect(ids(recent).slice(0, 3)).toEqual(["b10", "j12", "j11"]);
    expect(recent.every((i) => i.verdict === "accepted")).toBe(true);
    expect(awaiting[0]).toEqual({
      id: "j13",
      title: demo.assignments.find((a) => a.id === "j13")!.title[lang],
      sourceName: "example-org/lantern-notes",
      externalRef: "113",
      workRef: "215",
      employee: { id: "juniper", displayName: "Juniper" },
      workTypeId: "ui",
      round: 1,
      verdict: null,
    });
    expect(awaiting[1]).toMatchObject({ sourceName: "example-org/harbor-docs", externalRef: "51", workRef: "73", workTypeId: "docs" });
  });

  it("多輪的交辦顯示最新一輪的輪次與 PR 編號", async () => {
    const j07 = (await panel(db, "manager", "j07"))!.item;
    expect(j07).toMatchObject({ round: 2, workRef: "209", verdict: "accepted" });
  });

  it("staff：只看到 example-org/lantern-notes，待驗收只有 j13", async () => {
    const { awaiting, recent } = await list(db, "staff");
    expect(ids(awaiting)).toEqual(["j13"]);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((i) => i.sourceName === "example-org/lantern-notes")).toBe(true);
  });

  it("guest 與沒有身分：兩組都是空的，不拋錯", async () => {
    expect(await list(db, "guest")).toEqual({ awaiting: [], recent: [] });
    expect(await list(db, null)).toEqual({ awaiting: [], recent: [] });
  });

  it("initialSelection：待驗收的第一筆；沒有待驗收時不選取", async () => {
    expect(initialSelection(await list(db, "manager"))).toBe("j13");
    expect(initialSelection(await list(db, "guest"))).toBeNull();
    expect(initialSelection({ awaiting: [], recent: (await list(db, "manager")).recent })).toBeNull();
  });
});

describe("readReviewPanel：匯入虛構資料後", () => {
  it("manager 打開 j13（Juniper × 介面，少看）：變更收成摘要、全文收起、可以驗收", async () => {
    const p = (await panel(db, "manager", "j13"))!;
    expect(p.focus.level).toBe("light");
    expect(p.focus.points).toHaveLength(2);
    expect(p.focus.noPoints).toBe(false);
    expect(p.focus.changes).toEqual({ mode: "summary", count: 2 });
    expect(p.focus.body.collapsed).toBe(true);
    // 同名檢查只取最新一筆
    expect(p.focus.checks).toEqual([{ name: "ci", status: "pass" }]);
    expect(p.current).toMatchObject({ id: "j13-w1", round: 1, externalRef: "215" });
    expect(p.earlier).toEqual([]);
    expect(p.canDecide).toBe(true);
  });

  it("manager 打開 b11（Basil × 文件，逐項看）：變更逐項列出", async () => {
    const p = (await panel(db, "manager", "b11"))!;
    expect(p.focus.level).toBe("item");
    expect(p.focus.changes.mode).toBe("items");
    expect(p.focus.changes.mode === "items" && p.focus.changes.items).toHaveLength(1);
    expect(p.canDecide).toBe(true);
  });

  it("前幾輪與其驗收結果：j01 的第 1 輪退回「做錯了」；已驗收的工作不能再驗收", async () => {
    const p = (await panel(db, "manager", "j01"))!;
    expect(p.earlier).toHaveLength(1);
    expect(p.earlier[0]).toMatchObject({ round: 1, externalRef: "201", review: { verdict: "returned", reason: "wrong", note: null } });
    expect(p.current.round).toBe(2);
    expect(p.canDecide).toBe(false);
  });

  it("staff 打開 j13：內容同 manager 但不能驗收；b11 看不到", async () => {
    const [m, s] = [(await panel(db, "manager", "j13"))!, (await panel(db, "staff", "j13"))!];
    expect(s.focus).toEqual(m.focus);
    expect(s.canDecide).toBe(false);
    expect(await panel(db, "staff", "b11")).toBeNull();
  });

  it("guest、沒有身分與不存在的交辦：null", async () => {
    expect(await panel(db, "guest", "j13")).toBeNull();
    expect(await panel(db, null, "j13")).toBeNull();
    expect(await panel(db, "manager", "nope")).toBeNull();
  });

  it("標題、摘要、重點、變更說明與全文依目前語言顯示", async () => {
    const w = demo.assignments.find((a) => a.id === "j13")!.works[0];
    for (const language of [lang, other]) {
      const p = (await panel(db, "manager", "j13", language))!;
      expect(p.item.title).toBe(demo.assignments.find((a) => a.id === "j13")!.title[language]);
      expect(p.current.summary).toBe(w.summary[language]);
      expect(p.focus.points).toEqual(w.points.map((t) => t[language]));
      expect(p.focus.body.text).toBe(w.body[language]);
      const b11 = (await panel(db, "manager", "b11", language))!;
      const bw = demo.assignments.find((a) => a.id === "b11")!.works[0];
      expect(b11.focus.changes).toEqual({ mode: "items", items: bw.changes.map((c) => ({ path: c.path, summary: c.summary[language] })) });
    }
  });
});

describe("寫入後讀回", () => {
  it("人新增的工作：找不到翻譯時顯示原文；沒有重點時即使少看也逐項列出", async () => {
    const own = await open();
    try {
      const { id } = await createAssignment(own, "manager", { sourceId: "lantern-notes", title: "Own task", workTypeId: "ui", employeeId: "juniper" });
      const externalRef = await nextExternalRef(own, "manager", "lantern-notes");
      const changes = [{ path: "a.ts", summary: "Change A" }];
      await createWork(own, "manager", { assignmentId: id, externalRef, summary: "Sum", body: "Body", points: [], changes, checks: [] });
      const p = (await panel(own, "manager", id, other))!;
      expect(p.item.title).toBe("Own task");
      expect(p.focus.body.text).toBe("Body");
      expect(p.focus.level).toBe("light");
      expect(p.focus.noPoints).toBe(true);
      expect(p.focus.changes).toEqual({ mode: "items", items: changes });
      expect(ids((await list(own, "manager")).awaiting)).toEqual(["j13", "b11", id]);
    } finally {
      await own.close();
    }
  });

  it("manager 退回 j13（做錯了）：不再待驗收、移到最近驗收過的第一筆、Juniper × 介面變回逐項看", async () => {
    const own = await open();
    try {
      await createReview(own, "manager", { workId: "j13-w1", verdict: "returned", reason: "wrong", note: "Check the file name" });
      const { awaiting, recent } = await list(own, "manager");
      expect(ids(awaiting)).toEqual(["b11"]);
      expect(recent[0]).toMatchObject({ id: "j13", verdict: "returned" });
      const p = (await panel(own, "manager", "j13"))!;
      expect(p.focus.level).toBe("item");
      expect(p.focus.changes.mode).toBe("items");
      expect(p.canDecide).toBe(false);
      expect(p.earlier).toEqual([]);
    } finally {
      await own.close();
    }
  });

  it("manager 通過 b11：不再待驗收、移到最近驗收過的第一筆", async () => {
    const own = await open();
    try {
      await createReview(own, "manager", { workId: "b11-w1", verdict: "accepted" });
      const { awaiting, recent } = await list(own, "manager");
      expect(ids(awaiting)).toEqual(["j13"]);
      expect(recent[0]).toMatchObject({ id: "b11", verdict: "accepted" });
      expect((await panel(own, "manager", "b11"))!.canDecide).toBe(false);
    } finally {
      await own.close();
    }
  });

  it("staff 與 guest 不能驗收，讀回後資料不變", async () => {
    const own = await open();
    try {
      const before = await list(own, "manager");
      for (const identity of ["staff", "guest"]) {
        await expect(createReview(own, identity, { workId: "j13-w1", verdict: "accepted" })).rejects.toThrow();
      }
      expect(await list(own, "manager")).toEqual(before);
    } finally {
      await own.close();
    }
  });
});
