// 抽查（crew ADR 0008 第 7～9 點，#161）：看重點期間按交件順序每 N 件抽 1 件逐項看。
// 純函式：不讀資料庫、不產生介面文字；抽查不存（第 7 點），一律從交件、驗收、層級決定與事後更正推算。
import { lightPeriods } from "./rules";
import type { Correction, LevelDecision, Review, SpotCheck, TrustParams } from "./types";

/** 一份交件（`crew.works` 的一列）：交件時間與這一輪的驗收（還沒驗收時是 null）。 */
export interface SubmittedWork {
  id: string;
  submittedAt: string;
  reviewId: string | null;
}

const time = (iso: string): number => Date.parse(iso);

/**
 * 每件交件是否被抽查，只回傳被抽查的交件（交件 id → 序號與 N）。
 *
 * - 每段看重點的期間從一筆 `relax` 開始，到 `revoke`、下一筆 `relax`、或期間內的做錯了／事後更正為止（rules.ts 的 lightPeriods()）。
 * - 交件時間落在期間內（`relax ≤ 交件 < 結束`）的件，依交件時間、同時間依交件 id 排序，第 N、2N、3N…件被抽查。
 * - 收回或改回逐項看後序號歸零，下一次 `relax` 從 1 重新數。
 * - 期間已結束時，只算驗收時間不晚於結束的件（結束它的那次做錯了也算）；之後才驗收、或仍待驗收的件本來就是逐項看，不算抽查。
 */
export function spotChecks(
  works: readonly SubmittedWork[],
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  corrections: readonly Correction[],
  params: Pick<TrustParams, "spotEvery">,
): Map<string, SpotCheck> {
  const result = new Map<string, SpotCheck>();
  const every = params.spotEvery;
  if (!Number.isInteger(every) || every <= 0) return result;
  const decidedAt = new Map(reviews.map((r) => [r.id, r.decidedAt]));
  const sorted = [...works].sort((a, b) => time(a.submittedAt) - time(b.submittedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const period of lightPeriods(reviews, decisions, corrections)) {
    const start = time(period.start);
    const end = period.end === null ? Infinity : time(period.end);
    const inPeriod = sorted.filter((w) => time(w.submittedAt) >= start && time(w.submittedAt) < end);
    inPeriod.forEach((w, index) => {
      const ordinal = index + 1;
      if (ordinal % every !== 0) return;
      if (period.end !== null) {
        const reviewed = w.reviewId === null ? undefined : decidedAt.get(w.reviewId);
        if (reviewed === undefined || time(reviewed) > end) return;
      }
      result.set(w.id, { ordinal, every });
    });
  }
  return result;
}

/** 抽查與事後更正的統計（信任頁與報表用，crew ADR 0008 第 9、15 點）。 */
export interface TrustStats {
  /** 被抽查的件數與結果（還沒驗收的件只算在 `total`） */
  spotChecks: { total: number; accepted: number; wrong: number; other: number };
  /** 事後更正的次數 */
  corrections: number;
  /** 「這個錯沒有被標成重點」的次數（退回＋事後更正） */
  notInPoints: number;
}

/** 某員工 × 某類工作的統計；`reviews` 帶退回時的 `notInPoints`（store 的 StoredReview）。 */
export function trustStats(
  inputs: {
    works: readonly SubmittedWork[];
    reviews: readonly (Review & { notInPoints?: boolean })[];
    decisions: readonly LevelDecision[];
    corrections: readonly Correction[];
  },
  params: Pick<TrustParams, "spotEvery">,
): TrustStats {
  const checks = spotChecks(inputs.works, inputs.reviews, inputs.decisions, inputs.corrections, params);
  const byId = new Map(inputs.reviews.map((r) => [r.id, r]));
  const spot = { total: 0, accepted: 0, wrong: 0, other: 0 };
  for (const w of inputs.works) {
    if (!checks.has(w.id)) continue;
    spot.total += 1;
    const review = w.reviewId === null ? undefined : byId.get(w.reviewId);
    if (!review) continue;
    if (review.verdict === "accepted") spot.accepted += 1;
    else if (review.reason === "wrong") spot.wrong += 1;
    else spot.other += 1;
  }
  return {
    spotChecks: spot,
    corrections: inputs.corrections.length,
    notInPoints: inputs.reviews.filter((r) => r.notInPoints === true).length + inputs.corrections.filter((c) => c.notInPoints).length,
  };
}
