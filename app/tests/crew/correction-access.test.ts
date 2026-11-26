// 事後更正與逐條回饋的讀取範圍與寫入權限（#161、crew ADR 0008）。讀取比照 crew.reviews：看得到該次驗收才看得到。
// 寫入：can_review、不能冒名、時間由資料庫決定；更正只對通過、一次一筆；逐條回饋只能和驗收在同一交易寫入。
// 虛構資料中 Rowan × support 在客服信箱（青翼專案，staff 看得到），Linden × knowledge 在公司知識庫（長堤專案，staff 看不到）。
// demo.json 目前沒有更正與回饋（PR 2 才加），這裡在匯入前加上：k01-2 的更正、s13-1 的逐條回饋，順便測 seed 的寫入。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createCorrection, createReview, getReviewDetails, GuidelineError, listGuidelines, listReviews } from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import type { DemoFile } from "../../src/crew/demo/types";
import { openDatabase, type Database } from "../../src/db/database";

const t = (zh: string, en: string) => ({ "zh-TW": zh, en });

function demoWithLettingGo(): DemoFile {
  const demo = structuredClone(DEMO_RAW) as DemoFile;
  const review = (assignment: string, round: number) => demo.assignments.find((a) => a.id === assignment)!.works[round - 1].review!;
  const k012 = review("k01", 2);
  if (k012.verdict !== "accepted") throw new Error("k01-2 must be accepted");
  k012.correction = { id: "c-k01", correctedBy: "manager", correctedAt: "2026-09-04T10:00:00+08:00", note: t("漏了例外", "Missed an exception"), notInPoints: true };
  review("s13", 1).feedback = { points: [{ ordinal: 1, result: "ok" }], guidelines: [{ guideline: "g01", result: "not_done" }] };
  return demo;
}

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(demoWithLettingGo(), clientConfig) });
}, 30_000);
afterAll(async () => {
  await db.close();
});

const count = (identity: string | null, table: string) =>
  db.withIdentity(identity, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM crew.${table}`)).rows[0].n);

describe("讀取：看得到該次驗收才看得到", () => {
  it("manager 看得到 k01-2 的更正與 s13-1 的回饋（seed 寫入）", async () => {
    const k = await getReviewDetails(db, "manager", "k01-2");
    expect(k.correction).toMatchObject({ id: "c-k01", reviewId: "k01-2", notInPoints: true, correctedBy: "manager", correctedAt: "2026-09-04T02:00:00.000Z" });
    expect(k.feedback).toEqual({ points: [], guidelines: [] });
    expect(await getReviewDetails(db, "manager", "s13-1")).toEqual({
      correction: null,
      feedback: { points: [{ ordinal: 1, result: "ok" }], guidelines: [{ guidelineId: "g01", result: "not_done" }] },
    });
  });

  it("staff 看得到青翼專案的回饋，看不到長堤專案的更正", async () => {
    expect((await getReviewDetails(db, "staff", "s13-1")).feedback.guidelines).toHaveLength(1);
    expect(await getReviewDetails(db, "staff", "k01-2")).toEqual({ correction: null, feedback: { points: [], guidelines: [] } });
    expect(await count("staff", "review_corrections")).toBe(0);
  });

  it.each([["guest"], [null]])("%s：讀不到任何更正與回饋", async (identity) => {
    expect(await count(identity, "review_corrections")).toBe(0);
    expect(await count(identity, "review_feedback")).toBe(0);
  });

  it("守則被標「沒做到」的次數：g01 是 1（manager 與 staff 相同）", async () => {
    for (const identity of ["manager", "staff"]) {
      const g01 = (await listGuidelines(db, identity, { employeeId: "rowan", workTypeId: "support" })).find((g) => g.id === "g01")!;
      expect(g01.notDoneCount).toBe(1);
      expect(g01.sourceCorrectionId).toBeNull();
    }
  });

  it("pg_policies：兩張表的 SELECT policy 都只有一條 can_see，條件經 crew.reviews", async () => {
    const result = await db.withIdentity("manager", (tx) =>
      tx.query<{ tablename: string; policyname: string; qual: string }>(
        `SELECT tablename, policyname, qual FROM pg_policies
         WHERE schemaname = 'crew' AND tablename IN ('review_corrections', 'review_feedback') AND cmd IN ('SELECT', 'ALL') ORDER BY tablename`,
      ),
    );
    expect(result.rows.map((r) => [r.tablename, r.policyname])).toEqual([["review_corrections", "can_see"], ["review_feedback", "can_see"]]);
    for (const r of result.rows) expect(r.qual).toContain("reviews");
  });
});

describe("寫入：事後更正", () => {
  it("manager 更正通過的驗收並記成守則：同一交易寫入守則與確認，守則的來源是那次更正", async () => {
    const result = await createCorrection(db, "manager", { reviewId: "s13-1", note: "Check the order number first", saveAsGuideline: true });
    const details = await getReviewDetails(db, "manager", "s13-1");
    expect(details.correction).toMatchObject({ id: result.id, note: "Check the order number first", notInPoints: false, correctedBy: "manager" });
    const g = (await listGuidelines(db, "manager", { employeeId: "rowan", workTypeId: "support" })).find((x) => x.id === result.guidelineId)!;
    expect(g).toMatchObject({ sourceReviewId: "s13-1", sourceCorrectionId: result.id, status: "active", proposerKind: "human", proposedBy: "manager" });
    expect(g.sourceReview?.verdict).toBe("accepted");
    // 守則文件照常寫入：更正算一次做錯了，文件的日期是更正的日期（documentGuideline()）
    expect(result.guidelineDocument).toBe("written");
  });

  it("一次驗收只能更正一次；退回不能更正；兩者都不留下資料", async () => {
    const before = await count("manager", "review_corrections");
    await expect(createCorrection(db, "manager", { reviewId: "s13-1", note: "again" })).rejects.toThrow(/unique|duplicate key/);
    await expect(createCorrection(db, "manager", { reviewId: "s12-1", note: "returned" })).rejects.toThrow(/foreign key/);
    expect(await count("manager", "review_corrections")).toBe(before);
  });

  it("記成守則但備註是空的：GuidelineError，更正也不寫入", async () => {
    const before = await count("manager", "review_corrections");
    await expect(createCorrection(db, "manager", { reviewId: "s10-1", note: "  ", saveAsGuideline: true })).rejects.toBeInstanceOf(GuidelineError);
    expect(await count("manager", "review_corrections")).toBe(before);
  });

  it.each([["staff"], ["guest"], [null]])("%s：不能更正", async (identity) => {
    await expect(createCorrection(db, identity, { reviewId: "s10-1", note: "X" })).rejects.toThrow();
  });

  it("冒名與指定時間都被拒", async () => {
    await expect(db.withIdentity("manager", (tx) => tx.exec(
      "INSERT INTO crew.review_corrections (id, review_id, corrected_by) VALUES ('fake', 's10-1', 'staff')"))).rejects.toThrow(/row-level security/);
    await expect(db.withIdentity("manager", (tx) => tx.exec(
      "INSERT INTO crew.review_corrections (id, review_id, corrected_at) VALUES ('fake', 's10-1', '2030-01-01')"))).rejects.toThrow(/permission denied/);
  });
});

describe("寫入：逐條回饋與「沒被標成重點」", () => {
  it("驗收時同一交易寫入逐條回饋", async () => {
    const { id } = await createReview(db, "manager", {
      workId: "s14-w1", verdict: "accepted",
      feedback: { points: [{ ordinal: 1, result: "ok" }, { ordinal: 2, result: "problem" }], guidelines: [{ guidelineId: "g01", result: "done" }] },
    });
    expect((await getReviewDetails(db, "manager", id)).feedback).toEqual({
      points: [{ ordinal: 1, result: "ok" }, { ordinal: 2, result: "problem" }],
      guidelines: [{ guidelineId: "g01", result: "done" }],
    });
  });

  it("對象不屬於該次交件時整筆驗收回滾", async () => {
    const work = (await listReviews(db, "manager")).length;
    await expect(createReview(db, "manager", { workId: "k13-w1", verdict: "accepted", feedback: { points: [{ ordinal: 3, result: "ok" }] } }))
      .rejects.toThrow(/foreign key/);
    await expect(createReview(db, "manager", { workId: "k13-w1", verdict: "accepted", feedback: { guidelines: [{ guidelineId: "g01", result: "done" }] } }))
      .rejects.toThrow(/foreign key/);
    expect((await listReviews(db, "manager")).length).toBe(work);
  });

  it("之後補寫回饋被拒（只能在驗收的同一交易）", async () => {
    await expect(db.withIdentity("manager", (tx) => tx.exec(
      "INSERT INTO crew.review_feedback (review_id, work_id, target_kind, point_ordinal, result) VALUES ('s13-1', 's13-w1', 'point', 1, 'problem')",
    ))).rejects.toThrow(/row-level security/);
  });

  it("退回的「沒被標成重點」：做錯了可以；其他原因被拒、驗收不寫入", async () => {
    await expect(createReview(db, "manager", { workId: "k13-w1", verdict: "returned", reason: "different_approach", notInPoints: true }))
      .rejects.toThrow(/check constraint/);
    const { id } = await createReview(db, "manager", { workId: "k13-w1", verdict: "returned", reason: "wrong", notInPoints: true });
    expect((await listReviews(db, "manager")).find((r) => r.id === id)?.notInPoints).toBe(true);
    expect((await listReviews(db, "manager")).find((r) => r.id === "s13-1")?.notInPoints).toBe(false);
  });
});
