// 知識的來歷（#147，crew ADR 0007 決定 8）：當時的審查層級、退回次數、自動檢查的推算（純函式），
// 與匯入虛構資料後讀回的來歷（demo 一開始回流的只有 k12；退回後通過另以 k13 的第 2 輪寫入）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createReview, createWork, getAssignmentWorks } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { demoWorkId } from "../demo/types";
import type { LevelDecision, Review } from "../trust/types";
import { flowbackDocumentId } from "./flowback";
import { checkTally, levelAt, readFlowbackOrigin, returnedBefore } from "./origin";

const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
const at = (s: string) => new Date(s).toISOString();
const ok = (id: string, date: string): Review => ({ id, verdict: "accepted", reason: null, decidedAt: at(date) });

// Linden × 知識庫整理的縮影：k01 做錯了一次，k07 想要不一樣的做法；10/13 同意看重點
const reviews: Review[] = [
  { id: "k01-1", verdict: "returned", reason: "wrong", decidedAt: at("2026-09-02T15:00:00+08:00") },
  ok("k01-2", "2026-09-03T14:00:00+08:00"),
  { id: "k07-1", verdict: "returned", reason: "different_approach", decidedAt: at("2026-10-02T15:00:00+08:00") },
  ok("k07-2", "2026-10-03T14:00:00+08:00"),
  ok("k09-1", "2026-10-11T15:00:00+08:00"),
  ok("k11-1", "2026-10-21T15:00:00+08:00"),
];
const decisions: LevelDecision[] = [{ decision: "relax", decidedAt: at("2026-10-13T10:00:00+08:00") }];

describe("levelAt（純函式）", () => {
  it("同意看重點（10/13）之前通過的 k09 是逐項看，之後的 k11 是看重點", () => {
    expect(levelAt(reviews, decisions, at("2026-10-11T15:00:00+08:00"))).toBe("item");
    expect(levelAt(reviews, decisions, at("2026-10-21T15:00:00+08:00"))).toBe("light");
  });

  it("只用通過那一刻以前的紀錄：之後的「做錯了」不影響當時的層級", () => {
    const later: Review = { id: "k12-1", verdict: "returned", reason: "wrong", decidedAt: at("2026-10-27T15:00:00+08:00") };
    expect(levelAt([...reviews, later], decisions, at("2026-10-21T15:00:00+08:00"))).toBe("light");
    expect(levelAt([...reviews, later], decisions, at("2026-10-28T15:00:00+08:00"))).toBe("item");
  });
});

describe("returnedBefore、checkTally（純函式）", () => {
  it("退回次數只算通過之前的退回", () => {
    const k01 = reviews.slice(0, 2);
    expect(returnedBefore(k01, k01[1].decidedAt)).toBe(1);
    expect(returnedBefore([ok("k09-1", "2026-10-11T15:00:00+08:00")], at("2026-10-11T15:00:00+08:00"))).toBe(0);
  });

  it("自動檢查：通過數與總數；沒有檢查時是 null", () => {
    expect(checkTally([{ name: "a", status: "pass" }, { name: "b", status: "fail" }, { name: "c", status: "pass" }])).toEqual({ passed: 2, total: 3 });
    expect(checkTally([])).toBeNull();
  });
});

describe("readFlowbackOrigin：匯入虛構資料後", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());
  const lang = clientConfig.client.defaultLanguage;
  const read = (identity: string | null, workId: string) => readFlowbackOrigin(db, identity, flowbackDocumentId(workId), lang);

  it("k12（10/13 同意看重點之後）：主管驗收、看重點、第一次就通過、檢查 2/2、依照守則 1 條", async () => {
    expect(await read("manager", demoWorkId("k12", 1))).toMatchObject({
      assignmentId: "k12", employeeName: "Linden", decidedBy: "manager", decidedAt: at("2026-10-27T15:00:00+08:00"),
      level: "light", returned: 0, checks: { passed: 2, total: 2 }, guidelines: 1,
    });
  });

  it("看不到回流紀錄的身分（staff、沒有身分）、不是回流的文件：null", async () => {
    expect(await read("staff", demoWorkId("k12", 1))).toBeNull();
    expect(await read(null, demoWorkId("k12", 1))).toBeNull();
    expect(await readFlowbackOrigin(db, "manager", "not-a-flowback", lang)).toBeNull();
  });
});

describe("readFlowbackOrigin：退回後通過", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("k13 第 1 輪「做錯了」退回 → 第 2 輪通過：退回 1 次後通過、當時逐項看（做錯了改回逐項看）、檢查是通過那一輪的結果", async () => {
    const [first] = await getAssignmentWorks(db, "manager", "k13");
    await createReview(db, "manager", { workId: first.id, verdict: "returned", reason: "wrong" });
    const second = await createWork(db, "manager", {
      assignmentId: "k13", externalRef: null, summary: first.summary, body: first.body, points: [], changes: [],
      checks: [{ name: "format", status: "pass" }, { name: "required-fields", status: "fail" }, { name: "required-fields", status: "pass" }],
      guidelineIds: ["g05"],
    });
    const { flowback } = await createReview(db, "manager", { workId: second.id, verdict: "accepted" });
    expect(flowback).toBe("flowed");
    expect(await readFlowbackOrigin(db, "manager", flowbackDocumentId(second.id), clientConfig.client.defaultLanguage)).toMatchObject({
      assignmentId: "k13", level: "item", returned: 1, checks: { passed: 2, total: 2 }, guidelines: 1,
    });
  });
});
