// 信任規則的純函式（#19，#15 計畫第 6 節）：不讀資料庫、不讀檔案、不產生介面文字。
// 輸入是某位員工 × 某類工作的驗收紀錄與少看的決定。
import type {
  AutoReset,
  Dot,
  LevelDecision,
  RelaxSuggestion,
  Review,
  ReviewFocus,
  ReviewLevel,
  TrustParams,
  WorkForReview,
} from "./types";

const time = (iso: string): number => Date.parse(iso);

/** 依時間排序的複本（同時間保留原順序）。 */
function byTime<T extends { decidedAt: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => time(a.item.decidedAt) - time(b.item.decidedAt) || a.index - b.index)
    .map(({ item }) => item);
}

const isWrong = (review: Review): boolean => review.verdict === "returned" && review.reason === "wrong";

export function dotOf(review: Review): Dot {
  if (review.verdict === "accepted") return "ok";
  return review.reason === "wrong" ? "wrong" : "neutral";
}

/** 最近 `n` 次驗收的圓點（舊到新）；不足 `n` 次時只回傳實際的次數。 */
export function recentDots(reviews: readonly Review[], n: number): Dot[] {
  if (n <= 0) return [];
  return byTime(reviews).slice(-n).map(dotOf);
}

type Event = { kind: "decision"; decision: LevelDecision } | { kind: "review"; review: Review };

/**
 * 依時間走一遍決定與驗收，回傳最後的層級與「改回逐項看」的事件。
 * 同一時間的決定排在驗收之前：與該次 `wrong` 同時的 `relax` 不算在 `wrong` 之後。
 */
function replay(reviews: readonly Review[], decisions: readonly LevelDecision[]): { level: ReviewLevel; resets: AutoReset[] } {
  const events: Event[] = [
    ...byTime(decisions).map((decision): Event => ({ kind: "decision", decision })),
    ...byTime(reviews).map((review): Event => ({ kind: "review", review })),
  ];
  const at = (e: Event) => time(e.kind === "decision" ? e.decision.decidedAt : e.review.decidedAt);
  // Array.prototype.sort 是穩定排序：同時間時決定（排在前面）先處理
  events.sort((a, b) => at(a) - at(b));

  let level: ReviewLevel = "item";
  const resets: AutoReset[] = [];
  for (const e of events) {
    if (e.kind === "decision") {
      level = e.decision.decision === "relax" ? "light" : "item";
    } else if (isWrong(e.review)) {
      if (level === "light") resets.push({ review: e.review, at: e.review.decidedAt });
      level = "item";
    }
  }
  return { level, resets };
}

/**
 * 逐項看（`item`）或少看（`light`）。只有最新的決定是 `relax`、之後沒有 `wrong` 時才是 `light`；
 * 一次 `wrong` 就回到 `item`，要再少看必須有一筆時間在該次 `wrong` 之後的 `relax`。
 */
export function reviewLevel(reviews: readonly Review[], decisions: readonly LevelDecision[]): ReviewLevel {
  return replay(reviews, decisions).level;
}

/**
 * 建議少看：層級是 `item`、最近 `params.window` 次都沒有 `wrong`、驗收次數至少 `params.min` 時回傳，否則 `null`。
 * 有人為決定時，只計算最新一筆決定之後的驗收：收回（`revoke`）後重新累積。
 * 建議只是資料，不改變層級。
 */
export function relaxSuggestion(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  params: Pick<TrustParams, "window" | "min">,
): RelaxSuggestion | null {
  if (reviewLevel(reviews, decisions) !== "item") return null;
  const latest = byTime(decisions).at(-1);
  const counted = byTime(reviews).filter((r) => !latest || time(r.decidedAt) > time(latest.decidedAt));
  if (counted.length < params.min || params.window <= 0) return null;
  const basis = counted.slice(-params.window);
  if (basis.some(isWrong)) return null;
  return { basis };
}

/** 因做錯了改回逐項看的事件（在 `light` 期間發生 `wrong` 的那一次），依時間排序。 */
export function autoResets(reviews: readonly Review[], decisions: readonly LevelDecision[]): AutoReset[] {
  return replay(reviews, decisions).resets;
}

/**
 * 驗收面板要顯示的內容。要看的重點與自動檢查不論層級都放最上面；
 * `item` 時變更清單逐項列出，`light` 時收成一筆摘要；全文一律預設收起。
 * 重點為空時標出 `noPoints`，變更清單照逐項列出：沒有標出重點不當作可以少看。
 */
export function reviewFocus(work: WorkForReview, level: ReviewLevel): ReviewFocus {
  const noPoints = work.points.length === 0;
  const changes: ReviewFocus["changes"] =
    level === "light" && !noPoints ? { mode: "summary", count: work.changes.length } : { mode: "items", items: [...work.changes] };
  return {
    level,
    points: [...work.points],
    noPoints,
    checks: [...work.checks],
    changes,
    body: { text: work.body, collapsed: true },
  };
}
