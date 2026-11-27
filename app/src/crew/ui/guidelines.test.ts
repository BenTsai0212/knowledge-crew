// 守則的畫面（#145）的寫入：退回時記成守則、確認、修改後確認、不採用、收回、狀態已改變。每個 test 重建資料庫，
// 寫入後以畫面用的資料整理（readEmployees、readToday、readLedger）讀回，確認員工卡、首頁與工作帳本一起改變。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createReview, decideGuideline, getAssignmentWorks, GuidelineError } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { readEmployees } from "./employees";
import { homeToday } from "./home-today";
import { readLedger } from "./ledger";
import { readToday } from "./today";

const lang = clientConfig.client.defaultLanguage;

let db: Database;
beforeEach(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterEach(() => db.close());

const rowan = async () => (await readEmployees(db, "manager", lang, true)).find((e) => e.id === "rowan")!.guidelines;
const ledger = async (id: string) => (await readLedger(db, "manager", lang)).filter((e) => e.guideline?.id === id).map((e) => e.kind);
// 首頁「等你決定」的守則件數（#191 起子導覽「員工」的數字另含審查方式的建議，這裡只看守則）
const pendingCount = async () => homeToday(await readToday(db, "manager", lang, true)).guidelines.length;

describe("退回時記成守則", () => {
  it("勾選後同時寫入退回與守則：員工卡多一條生效的（退回時記下），帳本是退回、記成守則", async () => {
    const work = (await getAssignmentWorks(db, "manager", "s14")).at(-1)!;
    const { id, guidelineId } = await createReview(db, "manager", {
      workId: work.id, verdict: "returned", reason: "different_approach", note: "報價要附上有效期限", saveAsGuideline: true,
    });
    expect(guidelineId).not.toBeNull();
    const saved = (await rowan()).active.find((g) => g.id === guidelineId)!;
    expect(saved).toMatchObject({ text: "報價要附上有效期限", proposerKind: "human", status: "active", followed: 0, sourceAssignmentId: "s14" });
    const events = await readLedger(db, "manager", lang);
    const returned = events.findIndex((e) => e.id === `returned:${id}`);
    expect(events[returned + 1]).toMatchObject({ kind: "guidelineSaved", actor: "manager", guideline: { id: guidelineId, text: "報價要附上有效期限" } });
  });

  it("「流程上的小問題」或意見是空的：不能記成守則，驗收也不寫入", async () => {
    const work = (await getAssignmentWorks(db, "manager", "s14")).at(-1)!;
    await expect(createReview(db, "manager", { workId: work.id, verdict: "returned", reason: "process", note: "x", saveAsGuideline: true })).rejects.toThrow(GuidelineError);
    await expect(createReview(db, "manager", { workId: work.id, verdict: "returned", reason: "wrong", saveAsGuideline: true })).rejects.toThrow(GuidelineError);
    expect((await getAssignmentWorks(db, "manager", "s14")).at(-1)!.review).toBeNull();
  });
});

describe("員工頁的決定", () => {
  it("確認：Rowan 的守則從等確認移到生效；首頁與子導覽的數字歸零；帳本多一筆確認守則", async () => {
    expect(await pendingCount()).toBe(1);
    await decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm" });
    const g = await rowan();
    expect(g.pending).toEqual([]);
    expect(g.active.find((x) => x.id === "g02")).toMatchObject({ status: "active", revised: false });
    expect(g.active.find((x) => x.id === "g02")!.confirmedAt).not.toBeNull();
    expect(await pendingCount()).toBe(0);
    expect(await ledger("g02")).toEqual(["guidelineConfirmed", "guidelineProposed"]);
  });

  it("修改後確認：文字以修改後的為準，標示確認時修改；帳本是修改後確認守則", async () => {
    await decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm", revisedText: "先確認交易時間與卡號末四碼" });
    const g02 = (await rowan()).active.find((x) => x.id === "g02")!;
    expect(g02).toMatchObject({ text: "先確認交易時間與卡號末四碼", revised: true });
    expect(await ledger("g02")).toEqual(["guidelineEdited", "guidelineProposed"]);
  });

  it("不採用：收進已收回與不採用，帶不採用的日期", async () => {
    await decideGuideline(db, "manager", { guidelineId: "g02", decision: "reject" });
    const g = await rowan();
    expect(g.pending).toEqual([]);
    expect(g.closed.find((x) => x.id === "g02")).toMatchObject({ status: "rejected" });
    expect(g.closed.find((x) => x.id === "g02")!.closedAt).not.toBeNull();
    expect(await ledger("g02")).toEqual(["guidelineRejected", "guidelineProposed"]);
  });

  it("收回：生效的移到已收回；帳本是收回守則", async () => {
    await decideGuideline(db, "manager", { guidelineId: "g01", decision: "revoke" });
    const g = await rowan();
    expect(g.active.map((x) => x.id)).toEqual([]);
    expect(g.closed.find((x) => x.id === "g01")).toMatchObject({ status: "revoked" });
    expect(await ledger("g01")).toEqual(["guidelineRetired", "guidelineSaved"]);
  });

  it("狀態已改變（另一個畫面先決定了）：拋出 GuidelineError，不寫入", async () => {
    await decideGuideline(db, "manager", { guidelineId: "g02", decision: "reject" });
    await expect(decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm" })).rejects.toMatchObject({ code: "invalid-transition" });
    await expect(decideGuideline(db, "manager", { guidelineId: "g04", decision: "revoke" })).rejects.toMatchObject({ code: "invalid-transition" });
    expect(await ledger("g02")).toEqual(["guidelineRejected", "guidelineProposed"]);
  });

  it("不能驗收的身分（staff）寫入被拒絕", async () => {
    await expect(decideGuideline(db, "staff", { guidelineId: "g02", decision: "confirm" })).rejects.toThrow();
    expect((await rowan()).pending.map((x) => x.id)).toEqual(["g02"]);
  });
});
