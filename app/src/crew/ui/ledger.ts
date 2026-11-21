// 「工作帳本」的資料整理（#40 計畫第 1～3 節）：交辦、交件、驗收、同意少看與收回、因做錯了改回逐項看，
// 依時間新到舊列出。一律經 withIdentity() 讀取，可見範圍由 RLS 決定；改回逐項看由 autoResets() 推得，不另存。
import type { Transaction } from "@electric-sql/pglite";
import type { AccessFile, LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { getTrustInputs, listAssignments, listEmployees, listReviews, type AssignmentSummary } from "../db/store";
import { demoText } from "../demo/texts";
import { autoResets } from "../trust/rules";
import type { LevelDecisionKind, ReturnReason } from "../trust/types";

export type LedgerKind = "assigned" | "submitted" | "accepted" | "returned" | "relax" | "revoke" | "autoReset";

export interface LedgerAssignment {
  id: string;
  /** 目前語言的標題；找不到時是資料庫的原文 */
  title: string;
  repoFullName: string;
  issueNumber: number;
}

export interface LedgerEvent {
  /** `<kind>:<來源的 id>`，畫面的 key */
  id: string;
  kind: LedgerKind;
  /** ISO 8601 */
  at: string;
  employee: { id: string; displayName: string };
  workTypeId: string;
  /** 相關的交辦；層級決定沒有依據的驗收時是 null */
  assignment: LedgerAssignment | null;
  /** 誰做的：身分的 id；依規則自動發生（autoReset）時是 null */
  actor: string | null;
  /** 交件的輪次；其他種類是 null */
  round: number | null;
  /** 退回原因；其他種類是 null */
  reason: ReturnReason | null;
}

export interface LedgerFilter {
  employeeId?: string | null;
  workTypeId?: string | null;
}

// 原始資料：store.ts 沒有的讀取（交件的時間、層級決定的 id 與決定者）
interface WorkRow {
  id: string;
  assignmentId: string;
  round: number;
  submittedAt: string;
}

interface DecisionRow {
  id: string;
  employeeId: string;
  workTypeId: string;
  decision: LevelDecisionKind;
  basisReviewId: string | null;
  decidedBy: string;
  decidedAt: string;
}

export interface LedgerSources {
  assignments: AssignmentSummary[];
  employees: { id: string; displayName: string }[];
  works: WorkRow[];
  reviews: { id: string; workId: string; verdict: "accepted" | "returned"; reason: ReturnReason | null; decidedBy: string; decidedAt: string }[];
  decisions: DecisionRow[];
  /** 改回逐項看：造成它的驗收 id 與時間 */
  resets: { reviewId: string; at: string }[];
}

const iso = (value: Date | string): string => new Date(value).toISOString();

async function rows<T>(tx: Transaction, sql: string): Promise<T[]> {
  return (await tx.query<T>(sql)).rows;
}

function readWorks(db: Database, identity: string): Promise<WorkRow[]> {
  return db.withIdentity(identity, async (tx) => {
    const result = await rows<Omit<WorkRow, "submittedAt"> & { submittedAt: Date }>(
      tx,
      `SELECT id, assignment_id AS "assignmentId", round, submitted_at AS "submittedAt" FROM crew.works ORDER BY submitted_at, id`,
    );
    return result.map((w) => ({ ...w, submittedAt: iso(w.submittedAt) }));
  });
}

function readDecisions(db: Database, identity: string): Promise<DecisionRow[]> {
  return db.withIdentity(identity, async (tx) => {
    const result = await rows<Omit<DecisionRow, "decidedAt"> & { decidedAt: Date }>(
      tx,
      `SELECT id, employee_id AS "employeeId", work_type_id AS "workTypeId", decision, basis_review_id AS "basisReviewId",
              decided_by AS "decidedBy", decided_at AS "decidedAt"
       FROM crew.level_decisions ORDER BY decided_at, id`,
    );
    return result.map((d) => ({ ...d, decidedAt: iso(d.decidedAt) }));
  });
}

const pairKey = (employeeId: string, workTypeId: string) => `${employeeId}\u0000${workTypeId}`;

/** 同一時間時，新到舊列表中由上到下的順序：改回逐項看在造成它的退回上方；同時間的決定先於驗收發生，列在驗收下方。 */
const TIE_ORDER: Record<LedgerKind, number> = {
  autoReset: 0,
  accepted: 1,
  returned: 1,
  relax: 2,
  revoke: 2,
  submitted: 3,
  assigned: 4,
};

/** 依時間新到舊；同一時間依 TIE_ORDER，再依 id 遞減。 */
export function compareLedger(a: LedgerEvent, b: LedgerEvent): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (TIE_ORDER[a.kind] !== TIE_ORDER[b.kind]) return TIE_ORDER[a.kind] - TIE_ORDER[b.kind];
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * 把各來源轉成 LedgerEvent，依時間新到舊排序。
 * 層級決定只列出「目前看得到該員工 × 該工作類型至少一筆交辦」的（與 INSERT policy 的條件一致；#40 的 `## 決定` 1）。
 */
export function mergeLedger(sources: LedgerSources, language: LanguageCode): LedgerEvent[] {
  const employees = new Map(sources.employees.map((e) => [e.id, e]));
  const employee = (id: string) => employees.get(id) ?? { id, displayName: id };
  const assignments = new Map(sources.assignments.map((a) => [a.id, a]));
  const works = new Map(sources.works.map((w) => [w.id, w]));
  const reviews = new Map(sources.reviews.map((r) => [r.id, r]));
  const visiblePairs = new Set(sources.assignments.map((a) => pairKey(a.employeeId, a.workTypeId)));

  const toAssignment = (a: AssignmentSummary): LedgerAssignment => ({
    id: a.id,
    title: demoText("title", a.id, language) ?? a.title,
    repoFullName: a.repoFullName,
    issueNumber: a.issueNumber,
  });
  const base = (a: AssignmentSummary) => ({
    employee: employee(a.employeeId),
    workTypeId: a.workTypeId,
    assignment: toAssignment(a),
    round: null,
    reason: null,
  });
  const assignmentOfReview = (reviewId: string): AssignmentSummary | undefined => {
    const review = reviews.get(reviewId);
    const work = review && works.get(review.workId);
    return work && assignments.get(work.assignmentId);
  };

  const events: LedgerEvent[] = [];
  for (const a of sources.assignments) {
    events.push({ ...base(a), id: `assigned:${a.id}`, kind: "assigned", at: a.assignedAt, actor: a.assignedBy });
  }
  for (const w of sources.works) {
    const a = assignments.get(w.assignmentId);
    if (!a) continue;
    events.push({ ...base(a), id: `submitted:${w.id}`, kind: "submitted", at: w.submittedAt, actor: a.employeeId, round: w.round });
  }
  for (const r of sources.reviews) {
    const a = assignmentOfReview(r.id);
    if (!a) continue;
    events.push({ ...base(a), id: `${r.verdict}:${r.id}`, kind: r.verdict, at: r.decidedAt, actor: r.decidedBy, reason: r.reason });
  }
  for (const d of sources.decisions) {
    // RLS 已於 crew/0003 收緊到同一員工 × 同一工作類型（#49）；這裡的過濾保留，作為雙重保護
    if (!visiblePairs.has(pairKey(d.employeeId, d.workTypeId))) continue;
    const a = d.basisReviewId === null ? undefined : assignmentOfReview(d.basisReviewId);
    events.push({
      id: `${d.decision}:${d.id}`,
      kind: d.decision,
      at: d.decidedAt,
      employee: employee(d.employeeId),
      workTypeId: d.workTypeId,
      assignment: a ? toAssignment(a) : null,
      actor: d.decidedBy,
      round: null,
      reason: null,
    });
  }
  for (const reset of sources.resets) {
    const a = assignmentOfReview(reset.reviewId);
    if (!a) continue;
    events.push({ ...base(a), id: `autoReset:${reset.reviewId}`, kind: "autoReset", at: reset.at, actor: null });
  }
  return events.sort(compareLedger);
}

/** 依員工與工作類型篩選；沒有指定（null 或省略）的條件不篩選。 */
export function filterLedger(events: readonly LedgerEvent[], filter: LedgerFilter): LedgerEvent[] {
  return events.filter(
    (e) => (filter.employeeId == null || e.employee.id === filter.employeeId) && (filter.workTypeId == null || e.workTypeId === filter.workTypeId),
  );
}

/** 篩選的選項：只來自目前的事件，依出現的先後（id 去重）。 */
export function ledgerOptions(events: readonly LedgerEvent[]): { employees: { id: string; displayName: string }[]; workTypeIds: string[] } {
  const employees = new Map<string, { id: string; displayName: string }>();
  const workTypeIds = new Set<string>();
  for (const e of events) {
    if (!employees.has(e.employee.id)) employees.set(e.employee.id, e.employee);
    workTypeIds.add(e.workTypeId);
  }
  return { employees: [...employees.values()], workTypeIds: [...workTypeIds] };
}

/** 誰做的：身分用 client/access.json 角色的名稱（目前語言），找不到時顯示 id；員工用顯示名稱。null（依規則自動）回傳 null。 */
export function actorName(
  access: Pick<AccessFile, "roles">,
  employees: readonly { id: string; displayName: string }[],
  actor: string | null,
  language: LanguageCode,
): string | null {
  if (actor === null) return null;
  const role = access.roles.find((r) => r.id === actor);
  if (role) return Object.hasOwn(role.label, language) ? role.label[language] : actor;
  return employees.find((e) => e.id === actor)?.displayName ?? actor;
}

export async function readLedgerSources(db: Database, identity: string | null): Promise<LedgerSources> {
  // 沒有身分時比照 guest：不讀取（同 today.ts）
  if (identity === null) return { assignments: [], employees: [], works: [], reviews: [], decisions: [], resets: [] };
  const assignments = await listAssignments(db, identity);
  const employees = await listEmployees(db, identity);
  const works = await readWorks(db, identity);
  const reviews = await listReviews(db, identity);
  const decisions = await readDecisions(db, identity);
  const resets: LedgerSources["resets"] = [];
  const pairs = new Map(assignments.map((a) => [pairKey(a.employeeId, a.workTypeId), a]));
  for (const { employeeId, workTypeId } of pairs.values()) {
    const inputs = await getTrustInputs(db, identity, employeeId, workTypeId);
    for (const r of autoResets(inputs.reviews, inputs.decisions)) resets.push({ reviewId: r.review.id, at: r.at });
  }
  return {
    assignments,
    employees: employees.map(({ id, displayName }) => ({ id, displayName })),
    works,
    reviews: reviews.map(({ id, workId, verdict, reason, decidedBy, decidedAt }) => ({ id, workId, verdict, reason, decidedBy, decidedAt })),
    decisions,
    resets,
  };
}

/** 目前身分看得到的帳本，依時間新到舊。guest 與沒有身分時是空陣列。 */
export async function readLedger(db: Database, identity: string | null, language: LanguageCode): Promise<LedgerEvent[]> {
  return mergeLedger(await readLedgerSources(db, identity), language);
}
