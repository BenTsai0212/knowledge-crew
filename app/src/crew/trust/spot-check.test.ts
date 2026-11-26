import { describe, expect, it } from "vitest";
import { DEMO_PARAMS } from "./demo-params";
import { spotChecks, trustStats, type SubmittedWork } from "./spot-check";
import type { Correction, LevelDecision, ReturnReason, Review } from "./types";

// 第 i 天的時間；交件在 9 點、驗收在 12 點、決定在 18 點
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 0, day, hour)).toISOString();
const relax = (day: number): LevelDecision => ({ decision: "relax", decidedAt: at(day, 18) });
const revoke = (day: number): LevelDecision => ({ decision: "revoke", decidedAt: at(day, 18) });
const params = { spotEvery: 5 };

/** 第 day 天交件、同一天驗收（verdict 為 null 時還沒驗收） */
function work(id: string, day: number, verdict: "accepted" | ReturnReason | null = "accepted", hour = 9): { w: SubmittedWork; r: Review | null } {
  const r: Review | null =
    verdict === null
      ? null
      : verdict === "accepted"
        ? { id: `r-${id}`, verdict: "accepted", reason: null, decidedAt: at(day) }
        : { id: `r-${id}`, verdict: "returned", reason: verdict, decidedAt: at(day) };
  return { w: { id, submittedAt: at(day, hour), reviewId: r?.id ?? null }, r };
}

function inputs(items: { w: SubmittedWork; r: Review | null }[]) {
  return { works: items.map((i) => i.w), reviews: items.flatMap((i) => (i.r ? [i.r] : [])) };
}

/** 第 from 天到第 to 天每天交一件、當天通過 */
const daily = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => work(`w${from + i}`, from + i));

describe("spotChecks", () => {
  it("示範值 N 是 5", () => {
    expect(DEMO_PARAMS.spotEvery).toBe(5);
  });

  it("relax 之後交的件，第 N、2N…件被抽查，附序號與 N；relax 之前的件不算", () => {
    const { works, reviews } = inputs(daily(1, 15));
    const checks = spotChecks(works, reviews, [relax(3)], [], params);
    // 第 4 天起是第 1 件：第 8、13 天是第 5、10 件
    expect([...checks]).toEqual([
      ["w8", { ordinal: 5, every: 5 }],
      ["w13", { ordinal: 10, every: 5 }],
    ]);
  });

  it("沒有 relax 時沒有抽查", () => {
    const { works, reviews } = inputs(daily(1, 15));
    expect(spotChecks(works, reviews, [], [], params).size).toBe(0);
  });

  it("交件時間相同時依交件 id 排序；輸入順序不影響結果", () => {
    const items = [work("a1", 2), work("a2", 3), work("a3", 4), work("a4", 5), work("b", 6), work("a", 6)];
    const { works, reviews } = inputs(items);
    expect([...spotChecks([...works].reverse(), reviews, [relax(1)], [], params).keys()]).toEqual(["a"]);
  });

  it("仍在看重點時，待驗收的件也會被抽查", () => {
    const { works, reviews } = inputs([...daily(2, 5), work("pending", 6, null)]);
    expect(spotChecks(works, reviews, [relax(1)], [], params).get("pending")).toEqual({ ordinal: 5, every: 5 });
  });

  it("抽查時做錯了：該件仍是抽查，之後改回逐項看、序號歸零；重新 relax 從 1 數", () => {
    const items = [...daily(2, 5), work("wrong", 6, "wrong"), ...daily(7, 12), ...daily(14, 18)];
    const { works, reviews } = inputs(items);
    const checks = spotChecks(works, reviews, [relax(1), relax(13)], [], params);
    // 第 7～12 天是逐項看，不抽查；第 14 天起重新數，第 18 天是第 5 件
    expect([...checks.keys()]).toEqual(["wrong", "w18"]);
  });

  it("收回後重新計算：收回前未滿 N 件，收回後不抽查；重新 relax 從 1 數", () => {
    const { works, reviews } = inputs([...daily(2, 4), ...daily(6, 9), ...daily(11, 16)]);
    const checks = spotChecks(works, reviews, [relax(1), revoke(4), relax(10)], [], params);
    expect([...checks.keys()]).toEqual(["w15"]);
  });

  it("事後更正改回逐項看後重新計算", () => {
    const { works, reviews } = inputs(daily(2, 12));
    const correction: Correction = { id: "c", reviewId: "r-w3", correctedAt: at(5, 13), notInPoints: false };
    // 第 2～5 天交的 4 件之後更正：期間結束，之後沒有抽查
    expect(spotChecks(works, reviews, [relax(1)], [correction], params).size).toBe(0);
    expect([...spotChecks(works, reviews, [relax(1)], [], params).keys()]).toEqual(["w6", "w11"]);
  });

  it("期間結束後才驗收、或期間結束時仍待驗收的件不算抽查（本來就是逐項看）", () => {
    const late = work("late", 6, null);
    const { works, reviews } = inputs([...daily(2, 5), late]);
    expect(spotChecks(works, reviews, [relax(1), revoke(7)], [], params).size).toBe(0);
    const reviewedLate: Review = { id: "r-late", verdict: "accepted", reason: null, decidedAt: at(8) };
    expect(spotChecks([...works.slice(0, 4), { ...late.w, reviewId: "r-late" }], [...reviews, reviewedLate], [relax(1), revoke(7)], [], params).size).toBe(0);
  });

  it("N 不是正整數時沒有抽查", () => {
    const { works, reviews } = inputs(daily(2, 12));
    expect(spotChecks(works, reviews, [relax(1)], [], { spotEvery: 0 }).size).toBe(0);
  });
});

describe("trustStats", () => {
  it("抽查次數與結果、更正次數、「沒被標成重點」次數（退回＋更正）", () => {
    const items = [...daily(2, 5), work("wrong", 6, "wrong"), ...daily(7, 7), work("process", 8, "process"), ...daily(9, 16), work("pending", 17, null)];
    const { works, reviews } = inputs(items);
    const marked = reviews.map((r) => ({ ...r, notInPoints: r.id === "r-wrong" }));
    const corrections: Correction[] = [{ id: "c", reviewId: "r-w2", correctedAt: at(3, 13), notInPoints: true }];
    // 更正在第 3 天：只有 relax(4) 之後的期間
    const stats = trustStats({ works, reviews: marked, decisions: [relax(4), relax(7)], corrections }, params);
    // relax(4)：w5、wrong → 第 2 件就做錯了，沒有抽查。relax(7)（18 點）：process 起算，第 5 件是 w12、第 10 件是待驗收的 pending
    expect(stats).toEqual({ spotChecks: { total: 2, accepted: 1, wrong: 0, other: 0 }, corrections: 1, notInPoints: 2 });
  });

  it("抽查時做錯了與其他退回分開計算", () => {
    const { works, reviews } = inputs([...daily(2, 5), work("wrong", 6, "wrong"), ...daily(8, 11), work("process", 12, "process")]);
    const stats = trustStats({ works, reviews, decisions: [relax(1), relax(7)], corrections: [] }, params);
    expect(stats.spotChecks).toEqual({ total: 2, accepted: 0, wrong: 1, other: 1 });
    expect(stats.notInPoints).toBe(0);
  });
});
