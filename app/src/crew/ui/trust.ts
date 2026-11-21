// 「員工」與「信任」畫面共用的資料整理（#37 計畫第 1 節）：看得到的「員工 × 工作類型」各自的圓點、層級、
// 驗收次數、最近一次改回逐項看與建議少看。只用 store.ts 與 rules.ts，可見範圍由 RLS 決定。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { createLevelDecision, getTrustInputs, listAssignments, listEmployees, type StoredEmployee } from "../db/store";
import { demoText } from "../demo/texts";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, recentDots, relaxSuggestion, reviewLevel } from "../trust/rules";
import type { Dot, ReviewLevel, TrustParams } from "../trust/types";

export interface CrewEmployee {
  id: string;
  displayName: string;
  /** 目前語言的說明；沒有時是 null */
  roleNote: string | null;
}

export interface TrustSuggestion {
  /** 依據的驗收次數 */
  count: number;
  /** 依據中最新一筆驗收（同意少看時寫入 basis_review_id） */
  basisReviewId: string;
}

export interface TrustRow {
  employee: CrewEmployee;
  workTypeId: string;
  /** 最近 params.dots 次（舊到新） */
  dots: Dot[];
  level: ReviewLevel;
  /** 看得到的驗收次數 */
  reviewCount: number;
  /** 最近一次因做錯了改回逐項看的時間；沒有時是 null */
  lastReset: string | null;
  /** 只給能驗收的身分；沒有建議時是 null */
  suggestion: TrustSuggestion | null;
}

export interface Trust {
  /** 能驗收的身分（client/access.json 的 canReview）才有建議少看與按鈕 */
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
    const { reviews, decisions } = await getTrustInputs(db, identity, employeeId, workTypeId);
    // 建議只給能驗收的身分（只有他們能同意少看），與「今天」一致
    const suggestion = canReview ? relaxSuggestion(reviews, decisions, params) : null;
    rows.push({
      employee: byId.get(employeeId) ?? { id: employeeId, displayName: employeeId, roleNote: null },
      workTypeId,
      dots: recentDots(reviews, params.dots),
      level: reviewLevel(reviews, decisions),
      reviewCount: reviews.length,
      lastReset: autoResets(reviews, decisions).at(-1)?.at ?? null,
      suggestion: suggestion ? { count: suggestion.basis.length, basisReviewId: suggestion.basis.at(-1)!.id } : null,
    });
  }
  return { canReview, employees, rows };
}

type RowKey = Pick<TrustRow, "workTypeId"> & { employee: Pick<CrewEmployee, "id"> };

/** 同意少看：以建議依據中最新一筆驗收寫入 relax。權限由 RLS 把關，不能驗收的身分由資料庫拋錯。 */
export function agreeRelax(db: Database, identity: string | null, row: RowKey & { suggestion: TrustSuggestion }) {
  return createLevelDecision(db, identity, {
    employeeId: row.employee.id,
    workTypeId: row.workTypeId,
    decision: "relax",
    basisReviewId: row.suggestion.basisReviewId,
  });
}

/** 收回少看：寫入 revoke。權限同上。 */
export function revokeRelax(db: Database, identity: string | null, row: RowKey) {
  return createLevelDecision(db, identity, { employeeId: row.employee.id, workTypeId: row.workTypeId, decision: "revoke" });
}
