// 看重點的建議的依據與經過（#125，展示版第 3 階段）：純函式，不讀資料庫、不產生介面文字。
// - relaxProposals()：由驗收紀錄與層級決定推算「提出看重點的建議」的時間與依據（不新增資料表或欄位）。
// - suggestionBasis()、suggestionHistory()：以工作帳本的事件（ledger.ts）整理信任頁的「依據」與「建議的經過」。
// 規則一律呼叫 rules.ts 的 relaxSuggestion()，不另寫條件。
import { relaxSuggestion } from "../trust/rules";
import type { LevelDecision, Review, TrustParams } from "../trust/types";
import type { LedgerAssignment, LedgerEvent } from "./ledger";

/** 一次「提出看重點的建議」：觸發的那次驗收（時間相同）與當時的依據。 */
export interface RelaxProposal {
  review: Review;
  at: string;
  /** 依據的那幾次驗收（依時間排序） */
  basis: Review[];
}

const time = (iso: string): number => Date.parse(iso);

/** 依時間排序的複本（同時間保留原順序）。 */
const byTime = <T extends { decidedAt: string }>(items: readonly T[]): T[] =>
  items.map((item, index) => ({ item, index })).sort((a, b) => time(a.item.decidedAt) - time(b.item.decidedAt) || a.index - b.index).map(({ item }) => item);

/**
 * 提出看重點的建議的事件，依時間排序。以層級決定切成段（第一筆決定之前、每筆決定之後），
 * 每一段只取「第一次符合建議條件的那次驗收」：當下的驗收與不晚於它的決定（同時間決定在先，與 rules.ts 一致）
 * 傳給 relaxSuggestion() 不是 null 的第一次。同一段之後的驗收不再重複提出。
 */
export function relaxProposals(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  params: Pick<TrustParams, "window" | "min">,
): RelaxProposal[] {
  const all = byTime(reviews);
  const sorted = byTime(decisions);
  const proposals: RelaxProposal[] = [];
  let segment = -1;
  let proposed = false;
  all.forEach((review, i) => {
    const known = sorted.filter((d) => time(d.decidedAt) <= time(review.decidedAt));
    if (known.length !== segment) {
      segment = known.length;
      proposed = false;
    }
    if (proposed) return;
    const suggestion = relaxSuggestion(all.slice(0, i + 1), known, params);
    if (suggestion === null) return;
    proposals.push({ review, at: review.decidedAt, basis: suggestion.basis });
    proposed = true;
  });
  return proposals;
}

/** 依據的一次驗收：時間與工作（帳本找不到時 assignment 是 null）。 */
export interface BasisItem {
  reviewId: string;
  at: string;
  assignment: LedgerAssignment | null;
}

/** 驗收事件的 id 是 `<accepted|returned>:<驗收 id>`（ledger.ts 的 mergeLedger()）。 */
const reviewIdOf = (event: LedgerEvent): string | null =>
  event.kind === "accepted" || event.kind === "returned" ? event.id.slice(event.kind.length + 1) : null;

/** 依據的驗收 id 對到帳本的驗收事件（時間與工作），順序不變；帳本沒有的驗收（看不到）略過。 */
export function suggestionBasis(reviewIds: readonly string[], events: readonly LedgerEvent[]): BasisItem[] {
  const reviews = new Map<string, LedgerEvent>();
  for (const e of events) {
    const id = reviewIdOf(e);
    if (id !== null) reviews.set(id, e);
  }
  return reviewIds.flatMap((reviewId) => {
    const e = reviews.get(reviewId);
    return e ? [{ reviewId, at: e.at, assignment: e.assignment }] : [];
  });
}

/** 建議的經過的一步。actor 是身分的 id（帳本的 actor）。 */
export type HistoryStep =
  | { kind: "proposed"; at: string; basis: BasisItem[] }
  | { kind: "relax"; at: string; actor: string | null }
  /** 同意後的第一次驗收（以看重點進行） */
  | { kind: "effective"; at: string; assignment: LedgerAssignment | null }
  | { kind: "revoke"; at: string; actor: string | null }
  /** 看重點期間做錯了，依規則改回逐項看：造成它的那件工作 */
  | { kind: "autoReset"; at: string; assignment: LedgerAssignment | null };

/**
 * 一個「員工 × 工作類型」的建議經過，舊到新：提出看重點的建議、同意改看重點、生效（同意後的第一次驗收）、收回看重點、因做錯了改回逐項看。
 * events 是帳本的事件（新到舊，mergeLedger() 的順序）；同時間的先後沿用帳本的順序（決定先於同時間的驗收，改回在造成它的退回之後）。
 * 沒有任何經過時是空陣列。
 */
export function suggestionHistory(events: readonly LedgerEvent[], employeeId: string, workTypeId: string): HistoryStep[] {
  const mine = events.filter((e) => e.employee.id === employeeId && e.workTypeId === workTypeId).reverse();
  const steps: HistoryStep[] = [];
  let waiting = false;
  for (const e of mine) {
    switch (e.kind) {
      case "proposed":
        steps.push({ kind: "proposed", at: e.at, basis: suggestionBasis(e.basis ?? [], events) });
        break;
      case "relax":
        steps.push({ kind: "relax", at: e.at, actor: e.actor });
        waiting = true;
        break;
      case "accepted":
      case "returned":
        if (waiting) steps.push({ kind: "effective", at: e.at, assignment: e.assignment });
        waiting = false;
        break;
      case "revoke":
        steps.push({ kind: "revoke", at: e.at, actor: e.actor });
        waiting = false;
        break;
      case "autoReset":
        steps.push({ kind: "autoReset", at: e.at, assignment: e.assignment });
        waiting = false;
        break;
    }
  }
  return steps;
}
