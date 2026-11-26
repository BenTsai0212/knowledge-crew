// 虛構資料的起始信任狀態（#60 計畫第 2 節）：匯入 demo.json 後以 getTrustInputs 讀回，用 rules.ts 與 DEMO_PARAMS 計算。
// 四位 AI 員工在 demo 開始時的狀態由這裡斷言，不只寫在註解。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { getReviewDetails, getTrustSummary } from "../db/store";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, recentDotEntries, recentDots, relaxSuggestion, reviewLevel } from "../trust/rules";
import { DEMO_RAW } from "./load";
import { demoSeed } from "./seed";

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

// 事後更正與抽查（#161）一併計算：更正算一次做錯了，抽查由交件順序推算
const trust = async (employee: string, workType: string) => {
  const { inputs, spotChecks, stats } = await getTrustSummary(db, "manager", employee, workType, DEMO_PARAMS);
  const { reviews, decisions, corrections } = inputs;
  return {
    reviews,
    decisions,
    corrections,
    dots: recentDots(reviews, DEMO_PARAMS.dots),
    level: reviewLevel(reviews, decisions, corrections),
    suggestion: relaxSuggestion(reviews, decisions, DEMO_PARAMS, corrections),
    resets: autoResets(reviews, decisions, corrections),
    spotChecks: Object.fromEntries(spotChecks),
    stats,
  };
};

describe("demo 開始時的信任狀態（#60）", () => {
  it("DEMO_PARAMS 是計畫計算時的值（dots 10、window 10、min 10）", () => {
    expect(DEMO_PARAMS).toMatchObject({ dots: 10, window: 10, min: 10 });
  });

  it("Rowan × 客戶回覆：逐項看；最近 10 次內有做錯了，發生在看重點期間，帳本有一筆改回逐項看；沒有建議", async () => {
    const t = await trust("rowan", "support");
    // 16 次：#134 加了一筆「我想要不一樣的做法」的退回（s16-1，修正中），不是做錯了；#161 在同意與做錯了之間加了 4 次通過（s17～s20）
    expect(t.reviews).toHaveLength(20);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax"]);
    expect(t.dots).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "wrong", "ok", "ok", "neutral"]);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
    expect(t.resets.map((r) => r.review.id)).toEqual(["s12-1"]);
    // 做錯了在看重點的決定之後
    expect(Date.parse(t.resets[0].at)).toBeGreaterThan(Date.parse(t.decisions[0].decidedAt));
  });

  it("Sorrel × 貼文與商品介紹：逐項看；最近 10 次沒有做錯了、次數達門檻，有建議改看重點", async () => {
    const t = await trust("sorrel", "content");
    expect(t.reviews).toHaveLength(12);
    expect(t.decisions).toEqual([]);
    expect(t.dots).toEqual(["ok", "ok", "ok", "neutral", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(t.level).toBe("item");
    expect(t.suggestion?.basis.map((r) => r.id)).toEqual([
      "c02-1", "c03-1", "c04-1", "c05-1", "c05-2", "c06-1", "c07-1", "c08-1", "c09-1", "c10-1",
    ]);
    expect(t.resets).toEqual([]);
  });

  it("Linden × 知識庫整理：看重點（有一筆同意改看重點，之後沒有做錯了）", async () => {
    const t = await trust("linden", "knowledge");
    // 15 次：#134 加了一筆「我想要不一樣的做法」的退回（k15-1，修正中），不是做錯了，仍是看重點；
    // #161 在同意之前加了 k16（10/12 通過），讓 k01-2 的事後更正之後仍累積 10 次
    expect(t.reviews).toHaveLength(16);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax"]);
    expect(t.dots).toEqual(["ok", "neutral", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "neutral"]);
    expect(t.level).toBe("light");
    expect(t.suggestion).toBeNull();
    expect(t.resets).toEqual([]);
    const after = t.reviews.filter((r) => Date.parse(r.decidedAt) > Date.parse(t.decisions[0].decidedAt));
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((r) => r.reason === "wrong")).toBe(false);
  });

  it("Juniper × 網站與工具開發：同意改看重點 → 看重點驗收 5 次 → 收回，逐項看；收回後要重新累積，沒有建議（#125、#161）", async () => {
    const t = await trust("juniper", "dev");
    // 11 次：#161 在同意與收回（改為 11/10）之間加了 4 次通過（j12～j15）
    expect(t.reviews).toHaveLength(15);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax", "revoke"]);
    expect(t.dots).toEqual(["ok", "ok", "neutral", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
    expect(t.resets).toEqual([]);
    // 同意之前已累積 DEMO_PARAMS.min 次、沒有做錯；同意與收回之間有 5 次驗收（以看重點進行，第 5 件是抽查）；收回之後沒有驗收
    const [relax, revoke] = t.decisions.map((d) => Date.parse(d.decidedAt));
    const before = t.reviews.filter((r) => Date.parse(r.decidedAt) < relax);
    expect(before.length).toBeGreaterThanOrEqual(DEMO_PARAMS.min);
    expect(before.some((r) => r.reason === "wrong")).toBe(false);
    expect(t.reviews.filter((r) => Date.parse(r.decidedAt) > relax && Date.parse(r.decidedAt) < revoke)).toHaveLength(5);
    expect(t.reviews.filter((r) => Date.parse(r.decidedAt) > revoke)).toEqual([]);
  });
});

// 第 5 階段（crew ADR 0008 第 18 點，#161）：抽查、事後更正、逐條回饋與「沒被標成重點」
describe("demo 的抽查、事後更正與逐條回饋（#161）", () => {
  it("DEMO_PARAMS 的抽查是每 5 件抽 1 件", () => {
    expect(DEMO_PARAMS.spotEvery).toBe(5);
  });

  it("Rowan：同意後的第 5 件 s12 被抽查，抽查時做錯了，就是那一筆自動改回；退回時標了「沒被標成重點」", async () => {
    const t = await trust("rowan", "support");
    expect(t.spotChecks).toEqual({ "s12-w1": { ordinal: 5, every: 5 } });
    expect(t.resets.map((r) => r.review.id)).toEqual(["s12-1"]);
    expect(t.stats).toEqual({ spotChecks: { total: 1, accepted: 0, wrong: 1, other: 0 }, corrections: 0, notInPoints: 1 });
  });

  it("Juniper：同意後的第 5 件 j15 被抽查並通過；收回後不再抽查", async () => {
    const t = await trust("juniper", "dev");
    expect(t.spotChecks).toEqual({ "j15-w1": { ordinal: 5, every: 5 } });
    expect(t.stats.spotChecks).toEqual({ total: 1, accepted: 1, wrong: 0, other: 0 });
  });

  it("Linden：停在看重點，待驗收的 k17 是第 5 件（抽查），k13 是第 6 件（一般看重點）", async () => {
    const t = await trust("linden", "knowledge");
    expect(t.level).toBe("light");
    expect(t.spotChecks).toEqual({ "k17-w1": { ordinal: 5, every: 5 } });
    expect(t.stats.spotChecks).toEqual({ total: 1, accepted: 0, wrong: 0, other: 0 });
  });

  it("Linden：k01-2（已回流）在逐項看期間事後更正，不產生改回；圓點仍是通過、帶更正；同意的依據改為 k16-1", async () => {
    const t = await trust("linden", "knowledge");
    expect(t.corrections).toMatchObject([{ id: "cr01", reviewId: "k01-2", notInPoints: true }]);
    expect(t.resets).toEqual([]);
    expect(t.stats).toMatchObject({ corrections: 1, notInPoints: 1 });
    const all = recentDotEntries(t.reviews, t.corrections, t.reviews.length);
    expect(all.filter((e) => e.correction !== null).map((e) => [e.review.id, e.dot])).toEqual([["k01-2", "ok"]]);
    // 更正之前的依據（k01-2 起算的 10 次）不再成立：同意的時候以 k16-1 為最新的依據
    const before = t.reviews.filter((r) => Date.parse(r.decidedAt) < Date.parse(t.decisions[0].decidedAt));
    expect(relaxSuggestion(before, [], DEMO_PARAMS, t.corrections)?.basis.at(-1)?.id).toBe("k16-1");
  });

  it("逐條回饋：k12-1 的兩個重點與 g05、s13-1 的重點與 g01、s12-1 的 g01 沒做到", async () => {
    const details = async (id: string) => (await getReviewDetails(db, "manager", id)).feedback;
    expect(await details("k12-1")).toEqual({
      points: [{ ordinal: 1, result: "ok" }, { ordinal: 2, result: "problem" }],
      guidelines: [{ guidelineId: "g05", result: "done" }],
    });
    expect(await details("s13-1")).toEqual({ points: [{ ordinal: 1, result: "ok" }], guidelines: [{ guidelineId: "g01", result: "done" }] });
    expect(await details("s12-1")).toEqual({ points: [], guidelines: [{ guidelineId: "g01", result: "not_done" }] });
  });
});
