// 「員工」與「信任」畫面共用的資料整理（#37 計畫第 1 節）：看得到的「員工 × 工作類型」各自的圓點、層級、
// 驗收次數、最近一次改回逐項看與建議改看重點，以及信任頁的時間軸與說明（#75）。只用 store.ts 與 rules.ts，可見範圍由 RLS 決定。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { createLevelDecision, getTrustSummary, listAssignments, listEmployees, type StoredEmployee } from "../db/store";
import { demoText } from "../demo/texts";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, dotOf, recentDotEntries, relaxSuggestion, reviewLevel } from "../trust/rules";
import type { TrustStats } from "../trust/spot-check";
import type { Correction, Dot, LevelDecision, Review, ReviewLevel, TrustParams } from "../trust/types";

export interface CrewEmployee {
  id: string;
  displayName: string;
  /** 目前語言的說明；沒有時是 null */
  roleNote: string | null;
}

export interface TrustSuggestion {
  /** 依據的驗收次數 */
  count: number;
  /** 依據中最新一筆驗收（同意改看重點時寫入 basis_review_id） */
  basisReviewId: string;
  /** 依據的驗收 id，依時間排序（#125：信任頁列出這幾次） */
  basisReviewIds: string[];
}

export interface TrustRow {
  employee: CrewEmployee;
  workTypeId: string;
  /** 最近 params.dots 次（舊到新） */
  dots: Dot[];
  /** dots 的每一格被事後更正的時間（#164）；沒有更正時是 null */
  dotCorrections: (string | null)[];
  level: ReviewLevel;
  /** 看得到的驗收次數 */
  reviewCount: number;
  /** 最近一次因做錯了改回逐項看的時間；沒有時是 null */
  lastReset: string | null;
  /** 只給能驗收的身分；沒有建議時是 null */
  suggestion: TrustSuggestion | null;
  /** 信任頁的時間軸（#75） */
  timeline: TrustTimeline;
  /** 卡片下方的說明（#75）；沒有時是 null */
  note: TrustNote | null;
  /** 抽查的次數與結果（#166，crew ADR 0008 第 9 點）；還沒驗收的抽查只算在 `total` */
  spotChecks: TrustStats["spotChecks"];
  /** 事後更正與「錯在沒標成重點的地方」的次數（#168，crew ADR 0008 第 15 點） */
  misses: Pick<TrustStats, "corrections" | "notInPoints">;
}

/** 時間軸的一格：一次驗收的圓點、時間與當時的層級。 */
export interface TimelineCell {
  dot: Dot;
  at: string;
  level: ReviewLevel;
  /** 這次驗收（通過）被事後更正的時間（#164）；沒有更正時是 null */
  correctedAt: string | null;
  /** 這次驗收的交件是抽查（#166） */
  spot: boolean;
}

/** 層級改變的事件：同意改看重點、收回看重點、因做錯了自動改回逐項看。 */
export interface TimelineEvent {
  kind: "relax" | "revoke" | "reset";
  at: string;
}

export interface TrustTimeline {
  /** 最近 params.dots 次驗收（舊到新） */
  cells: TimelineCell[];
  /** 不足 params.dots 次時的空格數 */
  empty: number;
  /** 依格分組的事件：column 是 cells 的索引（決定放在它之後的第一次驗收；之後沒有驗收時放最後一格） */
  events: { column: number; items: TimelineEvent[] }[];
}

/** 卡片下方說明的種類，依優先順序：建議改看重點、看重點中、剛收回、剛自動改回、驗收不足。 */
export type TrustNote = "suggestion" | "light" | "revoked" | "reset" | "tooFew";

export interface Trust {
  /** 能驗收的身分（client/access.json 的 canReview）才有建議改看重點與按鈕 */
  canReview: boolean;
  employees: CrewEmployee[];
  rows: TrustRow[];
}

const EMPTY = (canReview: boolean): Trust => ({ canReview, employees: [], rows: [] });

export function toCrewEmployee(e: StoredEmployee, language: LanguageCode): CrewEmployee {
  return { id: e.id, displayName: e.displayName, roleNote: demoText("roleNote", e.id, language) ?? e.roleNote };
}

export async function readTrust(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  canReview: boolean,
  params: TrustParams = DEMO_PARAMS,
): Promise<Trust> {
  // 沒有身分時比照 guest：不讀取，不拋錯
  if (identity === null) return EMPTY(false);
  const [assignments, stored] = await Promise.all([listAssignments(db, identity), listEmployees(db, identity)]);
  const employees = stored.map((e) => toCrewEmployee(e, language));
  const byId = new Map(employees.map((e) => [e.id, e]));
  // 組合來自看得到的交辦；排序依員工（資料庫順序）再依工作類型 id
  const order = new Map(employees.map((e, i) => [e.id, i]));
  const pairs = new Map<string, { employeeId: string; workTypeId: string }>();
  for (const a of assignments) pairs.set(`${a.employeeId}\u0000${a.workTypeId}`, { employeeId: a.employeeId, workTypeId: a.workTypeId });
  const sorted = [...pairs.values()].sort(
    (a, b) =>
      (order.get(a.employeeId) ?? Infinity) - (order.get(b.employeeId) ?? Infinity) ||
      a.employeeId.localeCompare(b.employeeId) ||
      a.workTypeId.localeCompare(b.workTypeId),
  );
  const rows: TrustRow[] = [];
  for (const { employeeId, workTypeId } of sorted) {
    const { inputs, spotChecks, stats } = await getTrustSummary(db, identity, employeeId, workTypeId, params);
    const { reviews, decisions, corrections } = inputs;
    // 被抽查的交件的驗收 id（#166）：時間軸的那一格加上抽查記號
    const spotReviews = new Set(inputs.works.filter((w) => w.reviewId !== null && spotChecks.has(w.id)).map((w) => w.reviewId!));
    // 建議只給能驗收的身分（只有他們能同意改看重點），與首頁的今天的工作一致
    const suggestion = canReview ? relaxSuggestion(reviews, decisions, params, corrections) : null;
    const level = reviewLevel(reviews, decisions, corrections);
    const timeline = trustTimeline(reviews, decisions, params, corrections, spotReviews);
    const entries = recentDotEntries(reviews, corrections, params.dots);
    rows.push({
      employee: byId.get(employeeId) ?? { id: employeeId, displayName: employeeId, roleNote: null },
      workTypeId,
      dots: entries.map((e) => e.dot),
      dotCorrections: entries.map((e) => e.correction?.correctedAt ?? null),
      level,
      reviewCount: reviews.length,
      lastReset: autoResets(reviews, decisions, corrections).at(-1)?.at ?? null,
      suggestion: suggestion
        ? { count: suggestion.basis.length, basisReviewId: suggestion.basis.at(-1)!.id, basisReviewIds: suggestion.basis.map((r) => r.id) }
        : null,
      timeline,
      note: trustNote(reviews, decisions, level, suggestion !== null, params, corrections),
      spotChecks: stats.spotChecks,
      misses: { corrections: stats.corrections, notInPoints: stats.notInPoints },
    });
  }
  return { canReview, employees, rows };
}

/** 已驗收的抽查次數（#166：`spotSummary` 與報表的抽查欄只算這些；還沒驗收的不算） */
export const decidedSpotChecks = (spot: TrustStats["spotChecks"]): number => spot.accepted + spot.wrong + spot.other;

/** 信任頁的 `missSummary`（#168）：事後更正或沒標成重點的錯至少一次時才列出 */
export const hasMisses = (misses: TrustRow["misses"]): boolean => misses.corrections > 0 || misses.notInPoints > 0;

const time = (iso: string): number => Date.parse(iso);

/** 依時間排序的複本（同時間保留原順序）。 */
const byTime = <T extends { decidedAt: string }>(items: readonly T[]): T[] =>
  items.map((item, index) => ({ item, index })).sort((a, b) => time(a.item.decidedAt) - time(b.item.decidedAt) || a.index - b.index).map(({ item }) => item);

/**
 * 時間軸（#75）：最近 params.dots 次驗收的圓點與當時的層級，以及層級改變的事件。
 * 當時的層級＝該次驗收之前的驗收與不晚於它的決定（同時間決定在先，與 rules.ts 一致）算出的層級。
 * 事件早於顯示範圍時不列出。事後更正（#161）在更正的時間算一次做錯了：由它觸發的改回放在更正時間以前最後一次驗收的那一格。
 * `spotReviews` 是被抽查的交件的驗收 id（#166）：那一格的 `spot` 為 true。
 */
export function trustTimeline(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  params: Pick<TrustParams, "dots">,
  corrections: readonly Correction[] = [],
  spotReviews: ReadonlySet<string> = new Set(),
): TrustTimeline {
  const all = byTime(reviews);
  const sorted = byTime(decisions);
  const offset = Math.max(0, all.length - Math.max(0, params.dots));
  const cells = all.slice(offset).map((review, i): TimelineCell => {
    const before = all.slice(0, offset + i);
    const level = reviewLevel(
      before,
      sorted.filter((d) => time(d.decidedAt) <= time(review.decidedAt)),
      corrections.filter((c) => time(c.correctedAt) < time(review.decidedAt)),
    );
    const correctedAt = corrections.find((c) => c.reviewId === review.id)?.correctedAt ?? null;
    return { dot: dotOf(review), at: review.decidedAt, level, correctedAt, spot: spotReviews.has(review.id) };
  });
  const located: { index: number; event: TimelineEvent }[] = [
    ...sorted.map((d) => {
      const next = all.findIndex((r) => time(r.decidedAt) >= time(d.decidedAt));
      return { index: next === -1 ? all.length - 1 : next, event: { kind: d.decision, at: d.decidedAt } as TimelineEvent };
    }),
    ...autoResets(all, sorted, corrections).map((r) => ({
      index: r.correction ? all.filter((x) => time(x.decidedAt) <= time(r.at)).length - 1 : all.indexOf(r.review),
      event: { kind: "reset", at: r.at } as TimelineEvent,
    })),
  ];
  const events: TrustTimeline["events"] = [];
  // 同一格的事件依時間排序；同時間時決定在先（located 的順序）
  const ordered = located.map((l, i) => ({ ...l, i })).sort((a, b) => a.index - b.index || time(a.event.at) - time(b.event.at) || a.i - b.i);
  for (const { index, event } of ordered) {
    const column = index - offset;
    if (column < 0 || cells.length === 0) continue;
    const last = events.at(-1);
    if (last?.column === column) last.items.push(event);
    else events.push({ column, items: [event] });
  }
  return { cells, empty: Math.max(0, params.dots - cells.length), events };
}

/** 卡片下方的說明（#75），依 TrustNote 的優先順序；都不符合時是 null。 */
export function trustNote(
  reviews: readonly Review[],
  decisions: readonly LevelDecision[],
  level: ReviewLevel,
  hasSuggestion: boolean,
  params: Pick<TrustParams, "min">,
  corrections: readonly Correction[] = [],
): TrustNote | null {
  if (hasSuggestion) return "suggestion";
  if (level === "light") return "light";
  const latest = byTime(decisions).at(-1);
  const after = (at: string) => reviews.filter((r) => time(r.decidedAt) > time(at)).length;
  if (latest?.decision === "revoke" && after(latest.decidedAt) === 0) return "revoked";
  const reset = autoResets(reviews, decisions, corrections).at(-1);
  if (reset && (!latest || time(latest.decidedAt) <= time(reset.at))) return "reset";
  if (reviews.length < params.min) return "tooFew";
  return null;
}

// 日期與「今天」以展示公司的時區判斷（#153 第 8 點）；實作在 crew/time.ts。
export { isSameDay, shortDate } from "../time";

type RowKey = Pick<TrustRow, "workTypeId"> & { employee: Pick<CrewEmployee, "id"> };

/** 同意改看重點：以建議依據中最新一筆驗收寫入 relax。權限由 RLS 把關，不能驗收的身分由資料庫拋錯。 */
export function agreeRelax(db: Database, identity: string | null, row: RowKey & { suggestion: TrustSuggestion }) {
  return createLevelDecision(db, identity, {
    employeeId: row.employee.id,
    workTypeId: row.workTypeId,
    decision: "relax",
    basisReviewId: row.suggestion.basisReviewId,
  });
}

/** 收回看重點：寫入 revoke。權限同上。 */
export function revokeRelax(db: Database, identity: string | null, row: RowKey) {
  return createLevelDecision(db, identity, { employeeId: row.employee.id, workTypeId: row.workTypeId, decision: "revoke" });
}
