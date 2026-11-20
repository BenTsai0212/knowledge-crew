import { describe, expect, it } from "vitest";
import { DEMO_PARAMS } from "./demo-params";
import { autoResets, recentDots, relaxSuggestion, reviewFocus, reviewLevel } from "./rules";
import type { LevelDecision, ReturnReason, Review, WorkForReview } from "./types";

// 第 i 天的時間；同一天的驗收與決定用小時區分
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 0, day, hour)).toISOString();

const ok = (day: number, hour?: number): Review => ({ id: `r${day}-${hour ?? 12}`, verdict: "accepted", reason: null, decidedAt: at(day, hour) });
const ret = (reason: ReturnReason, day: number, hour?: number): Review => ({ id: `r${day}-${hour ?? 12}`, verdict: "returned", reason, decidedAt: at(day, hour) });
const relax = (day: number, hour = 18): LevelDecision => ({ decision: "relax", decidedAt: at(day, hour) });
const revoke = (day: number, hour = 18): LevelDecision => ({ decision: "revoke", decidedAt: at(day, hour) });

/** 第 from 天到第 to 天每天一次通過 */
const oks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ok(from + i));

const params = { window: 10, min: 10 };

describe("demo-params", () => {
  it("是第 0 階段的示範值", () => {
    expect(DEMO_PARAMS).toEqual({ dots: 10, window: 10, min: 10 });
  });
});

describe("recentDots", () => {
  it("剛好 n 次：每次一個圓點，舊到新", () => {
    const reviews = [...oks(1, 8), ret("wrong", 9), ret("different_approach", 10)];
    expect(recentDots(reviews, 10)).toEqual([...Array(8).fill("ok"), "wrong", "neutral"]);
  });

  it("超過 n 次只取最近的", () => {
    const reviews = [ret("wrong", 1), ret("process", 2), ...oks(3, 12)];
    expect(recentDots(reviews, 10)).toEqual(Array(10).fill("ok"));
    expect(recentDots(reviews, 11)).toEqual(["neutral", ...Array(10).fill("ok")]);
  });

  it("不足 n 次時只回傳實際的次數", () => {
    expect(recentDots([ok(1), ret("process", 2)], 10)).toEqual(["ok", "neutral"]);
    expect(recentDots([], 10)).toEqual([]);
  });

  it("兩種非「做錯了」的退回都是 neutral", () => {
    expect(recentDots([ret("different_approach", 1), ret("process", 2)], 10)).toEqual(["neutral", "neutral"]);
  });

  it("輸入未依時間排序時仍以時間取最近的", () => {
    expect(recentDots([ok(3), ret("wrong", 1), ok(2)], 2)).toEqual(["ok", "ok"]);
  });
});

describe("reviewLevel", () => {
  it("沒有任何決定時是 item（不會因驗收次數自動變成 light）", () => {
    expect(reviewLevel(oks(1, 30), [])).toBe("item");
  });

  it("最新的決定是 relax、之後沒有 wrong 時是 light", () => {
    expect(reviewLevel(oks(1, 12), [relax(10)])).toBe("light");
  });

  it("neutral 不影響層級", () => {
    const reviews = [...oks(1, 10), ret("different_approach", 11), ret("process", 12)];
    expect(reviewLevel(reviews, [relax(10)])).toBe("light");
  });

  it("一次 wrong 就回到 item", () => {
    expect(reviewLevel([...oks(1, 10), ret("wrong", 11), ok(12)], [relax(10)])).toBe("item");
  });

  it("wrong 之前的 relax 無效、之後的 relax 有效", () => {
    const reviews = [...oks(1, 10), ret("wrong", 11), ...oks(12, 14)];
    expect(reviewLevel(reviews, [relax(5)])).toBe("item");
    expect(reviewLevel(reviews, [relax(5), relax(12)])).toBe("light");
  });

  it("與 wrong 同時的 relax 不算在 wrong 之後", () => {
    expect(reviewLevel([ok(1), ret("wrong", 2, 12)], [relax(2, 12)])).toBe("item");
  });

  it("relax 之後的 revoke 回到 item", () => {
    expect(reviewLevel(oks(1, 12), [relax(10), revoke(11)])).toBe("item");
  });

  it("決定的輸入順序不影響結果（以時間為準）", () => {
    expect(reviewLevel(oks(1, 12), [revoke(11), relax(10)])).toBe("item");
    expect(reviewLevel(oks(1, 12), [relax(11), revoke(10)])).toBe("light");
  });
});

describe("relaxSuggestion", () => {
  it("item、最近 window 次沒有 wrong、次數達 min 時建議，附依據的那幾次", () => {
    const reviews = [ret("wrong", 1), ...oks(2, 11)];
    const suggestion = relaxSuggestion(reviews, [], params);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.basis).toEqual(oks(2, 11));
  });

  it("次數不足 min 時不建議", () => {
    expect(relaxSuggestion(oks(1, 9), [], params)).toBeNull();
  });

  it("最近 window 次內有 wrong 時不建議", () => {
    expect(relaxSuggestion([...oks(1, 5), ret("wrong", 6), ...oks(7, 15)], [], params)).toBeNull();
  });

  it("neutral 不影響建議（計入次數、不擋建議）", () => {
    const reviews = [...oks(1, 8), ret("different_approach", 9), ret("process", 10)];
    expect(relaxSuggestion(reviews, [], params)?.basis).toEqual(reviews);
  });

  it("已經是 light 時不建議", () => {
    expect(relaxSuggestion(oks(1, 20), [relax(10)], params)).toBeNull();
  });

  it("建議不改變層級", () => {
    const reviews = oks(1, 10);
    expect(relaxSuggestion(reviews, [], params)).not.toBeNull();
    expect(reviewLevel(reviews, [])).toBe("item");
  });

  it("revoke 後回到 item，並從 revoke 之後重新累積", () => {
    const decisions = [relax(10), revoke(15)];
    expect(relaxSuggestion(oks(1, 20), decisions, params)).toBeNull();
    const suggestion = relaxSuggestion(oks(1, 25), decisions, params);
    expect(suggestion?.basis).toEqual(oks(16, 25));
  });

  it("light 期間 wrong 改回 item 後，要再累積 window 次沒有 wrong 才建議", () => {
    const decisions = [relax(10)];
    expect(relaxSuggestion([...oks(1, 11), ret("wrong", 12), ...oks(13, 21)], decisions, params)).toBeNull();
    expect(relaxSuggestion([...oks(1, 11), ret("wrong", 12), ...oks(13, 22)], decisions, params)?.basis).toEqual(oks(13, 22));
  });
});

describe("autoResets", () => {
  it("light 期間的 wrong 出現在 autoResets，附時間", () => {
    const wrong = ret("wrong", 12);
    expect(autoResets([...oks(1, 11), wrong, ok(13)], [relax(10)])).toEqual([{ review: wrong, at: wrong.decidedAt }]);
  });

  it("item 期間的 wrong 不算改回", () => {
    expect(autoResets([ret("wrong", 1), ...oks(2, 5)], [])).toEqual([]);
    expect(autoResets([...oks(1, 11), ret("wrong", 12)], [relax(5), revoke(10)])).toEqual([]);
  });

  it("改回後的第二次 wrong 不重複計算；重新 relax 後的 wrong 再算一次", () => {
    const first = ret("wrong", 12);
    const second = ret("wrong", 13);
    const third = ret("wrong", 20);
    const reviews = [...oks(1, 11), first, second, ...oks(14, 19), third];
    expect(autoResets(reviews, [relax(10), relax(15)])).toEqual([
      { review: first, at: first.decidedAt },
      { review: third, at: third.decidedAt },
    ]);
  });

  it("neutral 不改回", () => {
    expect(autoResets([ret("different_approach", 12), ret("process", 13)], [relax(10)])).toEqual([]);
  });

  it("與 autoResets 一致：發生改回後層級是 item", () => {
    const reviews = [...oks(1, 11), ret("wrong", 12)];
    expect(autoResets(reviews, [relax(10)])).toHaveLength(1);
    expect(reviewLevel(reviews, [relax(10)])).toBe("item");
  });
});

describe("reviewFocus", () => {
  const work: WorkForReview = {
    points: ["point-a", "point-b"],
    checks: [
      { name: "checks", status: "pass" },
      { name: "e2e", status: "pending" },
    ],
    changes: [
      { path: "app/src/a.ts", summary: "summary-a" },
      { path: "app/src/b.ts", summary: "summary-b" },
      { path: "docs/c.md", summary: "summary-c" },
    ],
    body: "full-body",
  };

  it("item：重點與檢查在最上面，變更清單逐項列出，全文收起", () => {
    const focus = reviewFocus(work, "item");
    expect(Object.keys(focus).slice(1, 5)).toEqual(["points", "noPoints", "checks", "changes"]);
    expect(focus).toEqual({
      level: "item",
      points: work.points,
      noPoints: false,
      checks: work.checks,
      changes: { mode: "items", items: work.changes },
      body: { text: "full-body", collapsed: true },
    });
  });

  it("light：重點與檢查照樣顯示，變更清單收成一筆摘要（件數），全文收起", () => {
    expect(reviewFocus(work, "light")).toEqual({
      level: "light",
      points: work.points,
      noPoints: false,
      checks: work.checks,
      changes: { mode: "summary", count: 3 },
      body: { text: "full-body", collapsed: true },
    });
  });

  it("重點為空：標出 noPoints，層級不變成 light，變更清單逐項列出", () => {
    const empty = { ...work, points: [] };
    const item = reviewFocus(empty, "item");
    expect(item.noPoints).toBe(true);
    expect(item.level).toBe("item");
    expect(item.changes).toEqual({ mode: "items", items: work.changes });

    const light = reviewFocus(empty, "light");
    expect(light.noPoints).toBe(true);
    expect(light.changes).toEqual({ mode: "items", items: work.changes });
    expect(light.checks).toEqual(work.checks);
  });

  it("不修改輸入", () => {
    const copy = structuredClone(work);
    const focus = reviewFocus(work, "item");
    focus.points.push("x");
    expect(work).toEqual(copy);
  });
});
