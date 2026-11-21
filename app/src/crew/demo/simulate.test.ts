// 模擬交件（#29 計畫第 4、5 節）：以目前身分寫入下一輪的工作，檢查取最新一筆。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createAssignment, createReview, getAssignmentWorks, listAssignments } from "../db/store";
import { DEMO, DEMO_RAW } from "./load";
import { demoSeed } from "./seed";
import { pickReply, simulateSubmission } from "./simulate";
import type { DemoFile } from "./types";

const demo = DEMO as DemoFile;
const [first, second] = demo.simulations.find((s) => s.employee === "juniper" && s.workType === "dev")!.replies;

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("pickReply", () => {
  it("依輪次取回覆，不夠時沿用最後一則；沒有預先回覆時為 null", () => {
    expect(pickReply(demo, "juniper", "dev", 1)).toBe(first);
    expect(pickReply(demo, "juniper", "dev", 2)).toBe(second);
    expect(pickReply(demo, "juniper", "dev", 5)).toBe(second);
    expect(pickReply(demo, "rowan", "content", 1)).toBeNull();
  });
});

describe("simulateSubmission", () => {
  it("manager：交件後最新一輪為 1；退回後再交件為 2；文字依語言、檢查取最新一筆", async () => {
    const a = await createAssignment(db, "manager", { sourceId: "company-site", title: "New card", workTypeId: "dev", employeeId: "juniper" });

    const s1 = await simulateSubmission(db, "manager", a.id, demo, "zh-TW");
    expect(s1.round).toBe(1);
    let works = await getAssignmentWorks(db, "manager", a.id);
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({
      id: s1.workId,
      round: 1,
      externalRef: "39",
      summary: first.summary["zh-TW"],
      body: first.body["zh-TW"],
      points: first.points.map((p) => p["zh-TW"]),
      changes: first.changes.map((c) => ({ path: c.path, summary: c.summary["zh-TW"] })),
      checks: [{ name: "ci", status: "pass" }],
      review: null,
    });
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({ latestRound: 1, latestVerdict: null });

    await createReview(db, "manager", { workId: s1.workId, verdict: "returned", reason: "different_approach" });
    const s2 = await simulateSubmission(db, "manager", a.id, demo, "en");
    expect(s2.round).toBe(2);
    works = await getAssignmentWorks(db, "manager", a.id);
    expect(works[1]).toMatchObject({ id: s2.workId, externalRef: "40", summary: second.summary.en, checks: [{ name: "ci", status: "pass" }] });
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({ latestRound: 2, latestVerdict: null });
  });

  it("沒有預先回覆的員工 × 工作類型拋錯，不寫入", async () => {
    // demo.json 的四個組合都有預先回覆；交辦給沒有的組合（Rowan × 內容）
    const a = await createAssignment(db, "manager", { sourceId: "social-account", title: "No reply", workTypeId: "content", employeeId: "rowan" });
    await expect(simulateSubmission(db, "manager", a.id, demo, "zh-TW")).rejects.toThrow(/no prepared reply/);
    expect(await getAssignmentWorks(db, "manager", a.id)).toHaveLength(0);
  });

  it("staff 被拒；看不到的交辦（guest、沒有身分）拋錯；都沒有留下資料", async () => {
    await expect(simulateSubmission(db, "staff", "s14", demo, "zh-TW")).rejects.toThrow();
    for (const identity of ["guest", null]) {
      await expect(simulateSubmission(db, identity, "s14", demo, "zh-TW")).rejects.toThrow(/not found/);
    }
    expect(await getAssignmentWorks(db, "manager", "s14")).toHaveLength(1);
  });
});
