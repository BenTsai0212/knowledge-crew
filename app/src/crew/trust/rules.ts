// 信任規則的純函式（#19，#15 計畫第 6 節）：不讀資料庫、不讀檔案、不產生介面文字。
// 輸入是某位員工 × 某類工作的驗收紀錄與看重點的決定。
import type {
  AutoReset,
  Correction,
  Dot,
  LevelDecision,
  RelaxSuggestion,
  Review,
  ReviewFocus,
  ReviewLevel,
  SpotCheck,
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

/** 最近 `n` 次驗收的圓點與事後更正（舊到新）：更正過的那次仍是 `ok`，`correction` 不是 null（crew ADR 0008 第 3 點）。 */
export function recentDotEntries(
  reviews: readonly Review[],
  corrections: readonly Correction[],
  n: number,
): { review: Review; dot: Dot; correction: Correction | null }[] {
  if (n <= 0) return [];
  return byTime(reviews)
    .slice(-n)
    .map((review) => ({ review, dot: dotOf(review), correction: corrections.find((c) => c.reviewId === review.id) ?? null }));
}

type Event =
  | { kind: "decision"; decision: LevelDecision }
  | { kind: "review"; review: Review }
  | { kind: "correction"; correction: Correction };

/** 看重點的一段期間：從一筆 `relax` 開始，到 `revoke`、下一筆 `relax`、或期間內的做錯了／事後更正為止（`end` 為 null 表示仍在看重點）。 */
export interface LightPeriod {
  start: string;
  end: string | null;
}

/**
 * 依時間走一遍決定、驗收與事後更正，回傳最後的層級、「改回逐項看」的事件與看重點的期間。
 * 同一時間的順序：決定 → 驗收 → 更正。與該次 `wrong` 同時的 `relax` 不算在 `wrong` 之後；
 * 事後更正在更正的時間算一次 `wrong`（crew ADR 0008 第 2 點）。
 */
function replay(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  corrections: readonly Correction[],
): { level: ReviewLevel; resets: AutoReset[]; periods: LightPeriod[] } {
  const events: Event[] = [
    ...byTime(decisions).map((decision): Event => ({ kind: "decision", decision })),
    ...byTime(reviews).map((review): Event => ({ kind: "review", review })),
    ...corrections
      .map((c) => ({ decidedAt: c.correctedAt, c }))
      .sort((a, b) => time(a.decidedAt) - time(b.decidedAt))
      .map(({ c }): Event => ({ kind: "correction", correction: c })),
  ];
  const at = (e: Event) =>
    time(e.kind === "decision" ? e.decision.decidedAt : e.kind === "review" ? e.review.decidedAt : e.correction.correctedAt);
  // Array.prototype.sort 是穩定排序：同時間時依上面的順序（決定、驗收、更正）處理
  events.sort((a, b) => at(a) - at(b));

  let level: ReviewLevel = "item";
  const resets: AutoReset[] = [];
  const periods: LightPeriod[] = [];
  const close = (end: string) => {
    const open = periods.at(-1);
    if (open && open.end === null) open.end = end;
  };
  for (const e of events) {
    if (e.kind === "decision") {
      close(e.decision.decidedAt);
      if (e.decision.decision === "relax") periods.push({ start: e.decision.decidedAt, end: null });
      level = e.decision.decision === "relax" ? "light" : "item";
    } else if (e.kind === "review") {
      if (!isWrong(e.review)) continue;
      if (level === "light") {
        resets.push({ review: e.review, at: e.review.decidedAt });
        close(e.review.decidedAt);
      }
      level = "item";
    } else {
      const corrected = reviews.find((r) => r.id === e.correction.reviewId);
      if (level === "light") {
        if (corrected) resets.push({ review: corrected, at: e.correction.correctedAt, correction: e.correction });
        close(e.correction.correctedAt);
      }
      level = "item";
    }
  }
  return { level, resets, periods };
}

/** 看重點的期間（依時間排序）；抽查依這些期間計算序號。 */
export function lightPeriods(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  corrections: readonly Correction[] = [],
): LightPeriod[] {
  return replay(reviews, decisions, corrections).periods;
}

/**
 * 逐項看（`item`）或看重點（`light`）。只有最新的決定是 `relax`、之後沒有 `wrong` 與事後更正時才是 `light`；
 * 一次 `wrong`（或更正）就回到 `item`，要再看重點必須有一筆時間在它之後的 `relax`。
 */
export function reviewLevel(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  corrections: readonly Correction[] = [],
): ReviewLevel {
  return replay(reviews, decisions, corrections).level;
}

/**
 * 建議改看重點：層級是 `item`、最近 `params.window` 次都沒有 `wrong`、驗收次數至少 `params.min` 時回傳，否則 `null`。
 * 有人為決定時，只計算最新一筆決定之後的驗收：收回（`revoke`）後重新累積。
 * 事後更正也算 `wrong`：最新決定之後、依據的第一次驗收以後有更正時回傳 `null`（次數 `min` 只算驗收）。
 * 建議只是資料，不改變層級。
 */
export function relaxSuggestion(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  params: Pick<TrustParams, "window" | "min">,
  corrections: readonly Correction[] = [],
): RelaxSuggestion | null {
  if (reviewLevel(reviews, decisions, corrections) !== "item") return null;
  const latest = byTime(decisions).at(-1);
  const counted = byTime(reviews).filter((r) => !latest || time(r.decidedAt) > time(latest.decidedAt));
  if (counted.length < params.min || params.window <= 0) return null;
  const basis = counted.slice(-params.window);
  if (basis.some(isWrong)) return null;
  const from = time(basis[0]!.decidedAt);
  const corrected = corrections.some(
    (c) => time(c.correctedAt) >= from && (!latest || time(c.correctedAt) > time(latest.decidedAt)),
  );
  return corrected ? null : { basis };
}

/**
 * 因做錯了改回逐項看的事件（在 `light` 期間發生 `wrong` 或事後更正的那一次），依時間排序。
 * 由更正觸發時 `review` 是被更正的那次驗收、`at` 是更正的時間、`correction` 是那筆更正。
 */
export function autoResets(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  corrections: readonly Correction[] = [],
): AutoReset[] {
  return replay(reviews, decisions, corrections).resets;
}

/**
 * 驗收面板要顯示的內容。要看的重點與自動檢查不論層級都放最上面；
 * `item` 時變更清單逐項列出，`light` 時收成一筆摘要；全文一律預設收起。
 * 重點為空時標出 `noPoints`，變更清單照逐項列出：沒有標出重點不當作可以看重點。
 * 抽查（`options.spotCheck`，spot-check.ts）的那一件當作逐項看：變更清單逐項列出，結果帶上 `spotCheck`（crew ADR 0008 第 8、9 點）。
 */
export function reviewFocus(work: WorkForReview, level: ReviewLevel, options: { spotCheck?: SpotCheck | null } = {}): ReviewFocus {
  const noPoints = work.points.length === 0;
  const spotCheck = options.spotCheck ?? null;
  const changes: ReviewFocus["changes"] =
    level === "light" && !noPoints && spotCheck === null
      ? { mode: "summary", count: work.changes.length }
      : { mode: "items", items: [...work.changes] };
  return {
    level,
    points: [...work.points],
    noPoints,
    checks: [...work.checks],
    changes,
    body: { text: work.body, collapsed: true },
    ...(spotCheck ? { spotCheck } : {}),
  };
}
