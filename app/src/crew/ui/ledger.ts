// 「工作帳本」的資料整理（#40 計畫第 1～3 節；#77 加上事件篩選與列的樣式）：交辦、交件、驗收、同意改看重點與收回、因做錯了改回逐項看，
// 依時間新到舊列出。一律經 withIdentity() 讀取，可見範圍由 RLS 決定；改回逐項看由 autoResets() 推得，不另存。
// #125 加上「提出看重點的建議」：由 relaxProposals()（suggestion-history.ts）推得，同樣不另存。
// #145 加上守則的事件（提出、記成、確認、修改後確認、不採用、收回）：由守則與其決定推得，同樣不另存。
// #164 加上事後更正（crew ADR 0008）：更正本身是一個事件，由它觸發的改回逐項看標出 `byCorrection`。
import type { Transaction } from "@electric-sql/pglite";
import { clientConfig } from "../../client/load";
import type { AccessFile, LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import {
  getTrustInputs, listAssignments, listEmployees, listGuidelines, listReviews, type AssignmentSummary, type SourceKind, type StoredGuideline,
} from "../db/store";
import { demoText } from "../demo/texts";
import { proposedText, revisionText } from "./guideline-text";
import { sourceLabel } from "./refs";
import { autoResets } from "../trust/rules";
import { relaxProposals } from "./suggestion-history";
import { DEMO_PARAMS } from "../trust/demo-params";
import type { LevelDecisionKind, ReturnReason, TrustParams } from "../trust/types";

export type LedgerKind =
  | "assigned" | "submitted" | "accepted" | "returned" | "corrected" | "proposed" | "relax" | "revoke" | "autoReset"
  | GuidelineLedgerKind;

/** 守則的事件（#145）：員工提出、退回時記成守則（人提）、確認、修改後確認、不採用、收回 */
export type GuidelineLedgerKind =
  | "guidelineProposed" | "guidelineSaved" | "guidelineConfirmed" | "guidelineEdited" | "guidelineRejected" | "guidelineRetired";

const GUIDELINE_KINDS: ReadonlySet<LedgerKind> = new Set<GuidelineLedgerKind>([
  "guidelineProposed", "guidelineSaved", "guidelineConfirmed", "guidelineEdited", "guidelineRejected", "guidelineRetired",
]);

/** 守則的事件（「只看守則」的篩選） */
export const isGuidelineEvent = (kind: LedgerKind): kind is GuidelineLedgerKind => GUIDELINE_KINDS.has(kind);

export interface LedgerAssignment {
  id: string;
  /** 目前語言的標題；找不到時是資料庫的原文 */
  title: string;
  sourceKind: SourceKind;
  sourceName: string;
  externalRef: string | null;
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
  /** 誰做的：身分的 id；依規則自動發生（proposed、autoReset）時是 null */
  actor: string | null;
  /** 交件與驗收的輪次；其他種類是 null */
  round: number | null;
  /** 退回原因；其他種類是 null */
  reason: ReturnReason | null;
  /** 提出看重點的建議（proposed）的依據：驗收 id，依時間排序；其他種類沒有 */
  basis?: string[];
  /** 守則的事件：守則 id 與該事件當時的文字（目前語言）；其他種類沒有 */
  guideline?: { id: string; text: string };
  /** 事後更正（corrected）的備註；沒寫備註或其他種類沒有 */
  note?: string;
  /** 由事後更正觸發的改回逐項看（autoReset）；其他沒有 */
  byCorrection?: true;
}

/** 事件的篩選（設計規格 v3 第 6.7 節）：全部／只看層級改變／只看退回／只看守則（#145） */
export type LedgerEventFilter = "all" | "level" | "returned" | "guideline";

export interface LedgerFilter {
  employeeId?: string | null;
  workTypeId?: string | null;
  event?: LedgerEventFilter;
}

/** 「載入更早的紀錄」一次多顯示的筆數；資料已全部讀進來，只是分批顯示（#77） */
export const LEDGER_PAGE_SIZE = 20;

const LEVEL_KINDS: ReadonlySet<LedgerKind> = new Set(["relax", "revoke", "autoReset"]);

/** 層級改變的紀錄：同意改看重點、收回看重點、因做錯了改回逐項看（畫面以灰底標出）。 */
export const isLevelChange = (kind: LedgerKind): boolean => LEVEL_KINDS.has(kind);

/** 「只看層級改變」的篩選：層級改變，加上提出看重點的建議（#125；建議不改變層級，不以灰底標出）。 */
export const inLevelFilter = (kind: LedgerKind): boolean => isLevelChange(kind) || kind === "proposed";

/** 事件文字的樣式：層級改變是粗體灰底列，退回（做錯了）與事後更正（算一次做錯了）是 danger 粗體，其他沒有。 */
export function ledgerTone(event: Pick<LedgerEvent, "kind" | "reason">): "level" | "wrong" | null {
  if (isLevelChange(event.kind)) return "level";
  return (event.kind === "returned" && event.reason === "wrong") || event.kind === "corrected" ? "wrong" : null;
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
  /** 改回逐項看：造成它的驗收 id 與時間；由事後更正觸發時 `byCorrection`（#164） */
  resets: { reviewId: string; at: string; byCorrection?: boolean }[];
  /** 事後更正（#164）；省略時沒有 */
  corrections?: LedgerCorrection[];
  /** 提出看重點的建議（#125）：觸發的驗收 id、時間與依據的驗收 id；省略時沒有 */
  proposals?: { reviewId: string; at: string; basis: string[] }[];
  /** 守則與其決定（#145）；省略時沒有 */
  guidelines?: LedgerGuideline[];
}

/** 帳本用的守則：store.ts 的守則；text 是提出時的文字、revisedText 是修改後的文字，都已換成目前語言 */
export type LedgerGuideline = Pick<StoredGuideline, "id" | "employeeId" | "workTypeId" | "sourceAssignmentId" | "proposerKind" | "proposedBy" | "proposedAt"> & {
  text: string;
  decisions: { id: string; decision: "confirm" | "reject" | "revoke"; revisedText: string | null; decidedBy: string; decidedAt: string }[];
};

/** 帳本用的事後更正（`crew.review_corrections` 的一列） */
export interface LedgerCorrection {
  id: string;
  reviewId: string;
  note: string | null;
  correctedBy: string;
  correctedAt: string;
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

function readCorrections(db: Database, identity: string): Promise<LedgerCorrection[]> {
  return db.withIdentity(identity, async (tx) => {
    const result = await rows<Omit<LedgerCorrection, "correctedAt"> & { correctedAt: Date }>(
      tx,
      `SELECT id, review_id AS "reviewId", note, corrected_by AS "correctedBy", corrected_at AS "correctedAt"
       FROM crew.review_corrections ORDER BY corrected_at, id`,
    );
    return result.map((c) => ({ ...c, correctedAt: iso(c.correctedAt) }));
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
  // 提出看重點的建議在觸發它的驗收上方（同一次驗收不會同時改回逐項看）
  proposed: 0,
  accepted: 1,
  returned: 1,
  // 事後更正（#164）：由它觸發的改回逐項看在上方
  corrected: 1,
  relax: 2,
  revoke: 2,
  // 守則（#145）：退回時記成守則與那次退回同時，列在退回下方（退回在前、記成守則在後）
  guidelineSaved: 2,
  guidelineProposed: 2,
  guidelineConfirmed: 2,
  guidelineEdited: 2,
  guidelineRejected: 2,
  guidelineRetired: 2,
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
    sourceKind: a.sourceKind,
    sourceName: sourceLabel(a.sourceId, a.sourceName, language),
    externalRef: a.externalRef,
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
    const round = works.get(r.workId)?.round ?? null;
    events.push({ ...base(a), id: `${r.verdict}:${r.id}`, kind: r.verdict, at: r.decidedAt, actor: r.decidedBy, round, reason: r.reason });
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
    const byCorrection = reset.byCorrection ? { byCorrection: true as const } : {};
    events.push({ ...base(a), id: `autoReset:${reset.reviewId}`, kind: "autoReset", at: reset.at, actor: null, ...byCorrection });
  }
  for (const c of sources.corrections ?? []) {
    const a = assignmentOfReview(c.reviewId);
    if (!a) continue;
    const round = works.get(reviews.get(c.reviewId)!.workId)?.round ?? null;
    const note = c.note === null || c.note.trim() === "" ? {} : { note: c.note };
    events.push({ ...base(a), id: `corrected:${c.id}`, kind: "corrected", at: c.correctedAt, actor: c.correctedBy, round, ...note });
  }
  for (const p of sources.proposals ?? []) {
    const a = assignmentOfReview(p.reviewId);
    if (!a) continue;
    events.push({ ...base(a), id: `proposed:${p.reviewId}`, kind: "proposed", at: p.at, actor: null, basis: [...p.basis] });
  }
  for (const g of sources.guidelines ?? []) events.push(...guidelineEvents(g, employee, (id) => assignments.get(id), toAssignment));
  return events.sort(compareLedger);
}

const DECISION_KIND = { reject: "guidelineRejected", revoke: "guidelineRetired" } as const;

/**
 * 一條守則的事件：員工提的是「提出守則」（經手人是員工），人提的是「記成守則」（經手人是驗收者；同時寫入的確認不另列）；
 * 之後的決定是確認、修改後確認、不採用、收回（經手人是決定者）。
 * 每個事件帶當時的文字：提出與記成是提出時的文字，修改後確認是修改後的文字，其他是該事件發生時的文字（#146 的修正要求）。
 */
function guidelineEvents(
  g: LedgerGuideline,
  employee: (id: string) => { id: string; displayName: string },
  assignmentOf: (id: string) => AssignmentSummary | undefined,
  toAssignment: (a: AssignmentSummary) => LedgerAssignment,
): LedgerEvent[] {
  const source = assignmentOf(g.sourceAssignmentId);
  const base = {
    employee: employee(g.employeeId),
    workTypeId: g.workTypeId,
    assignment: source ? toAssignment(source) : null,
    round: null,
    reason: null,
  };
  let text = g.text;
  const human = g.proposerKind === "human";
  const events: LedgerEvent[] = [
    human
      ? { ...base, id: `guidelineSaved:${g.id}`, kind: "guidelineSaved", at: g.proposedAt, actor: g.proposedBy ?? g.decisions[0]?.decidedBy ?? null, guideline: { id: g.id, text } }
      : { ...base, id: `guidelineProposed:${g.id}`, kind: "guidelineProposed", at: g.proposedAt, actor: g.employeeId, guideline: { id: g.id, text } },
  ];
  // decisions 依時間排序：修改後確認之後的事件帶修改後的文字
  for (const d of g.decisions) {
    if (d.decision === "confirm" && d.revisedText !== null) text = d.revisedText;
    // 人提的守則，勾選「記成守則」就是確認（ADR 0007 決定 2），併在「記成守則」
    if (d.decision === "confirm" && human) continue;
    const kind: GuidelineLedgerKind =
      d.decision === "confirm" ? (d.revisedText === null ? "guidelineConfirmed" : "guidelineEdited") : DECISION_KIND[d.decision];
    events.push({ ...base, id: `${kind}:${d.id}`, kind, at: d.decidedAt, actor: d.decidedBy, guideline: { id: g.id, text } });
  }
  return events;
}

/** 工作欄的守則文字：超過 max 個字元時截斷並加上「…」 */
export function truncateText(text: string, max = 40): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const matchesEvent = (kind: LedgerKind, event: LedgerEventFilter = "all"): boolean => {
  if (event === "all") return true;
  if (event === "level") return inLevelFilter(kind);
  if (event === "guideline") return isGuidelineEvent(kind);
  // 事後更正（#164）與退回同一組
  return kind === "returned" || kind === "corrected";
};

/** 依員工、工作類型與事件篩選；沒有指定（null、省略或 "all"）的條件不篩選。 */
export function filterLedger(events: readonly LedgerEvent[], filter: LedgerFilter): LedgerEvent[] {
  return events.filter(
    (e) =>
      (filter.employeeId == null || e.employee.id === filter.employeeId) &&
      (filter.workTypeId == null || e.workTypeId === filter.workTypeId) &&
      matchesEvent(e.kind, filter.event),
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

export async function readLedgerSources(
  db: Database,
  identity: string | null,
  language: LanguageCode = clientConfig.client.defaultLanguage,
  params: TrustParams = DEMO_PARAMS,
): Promise<LedgerSources> {
  // 沒有身分時比照 guest：不讀取（同 today.ts）
  if (identity === null) return { assignments: [], employees: [], works: [], reviews: [], decisions: [], resets: [], corrections: [], proposals: [], guidelines: [] };
  const assignments = await listAssignments(db, identity);
  const employees = await listEmployees(db, identity);
  const works = await readWorks(db, identity);
  const reviews = await listReviews(db, identity);
  const decisions = await readDecisions(db, identity);
  const resets: LedgerSources["resets"] = [];
  const proposals: NonNullable<LedgerSources["proposals"]> = [];
  const pairs = new Map(assignments.map((a) => [pairKey(a.employeeId, a.workTypeId), a]));
  for (const { employeeId, workTypeId } of pairs.values()) {
    const inputs = await getTrustInputs(db, identity, employeeId, workTypeId);
    for (const r of autoResets(inputs.reviews, inputs.decisions, inputs.corrections)) {
      resets.push({ reviewId: r.review.id, at: r.at, ...(r.correction ? { byCorrection: true } : {}) });
    }
    for (const p of relaxProposals(inputs.reviews, inputs.decisions, params, inputs.corrections)) {
      proposals.push({ reviewId: p.review.id, at: p.at, basis: p.basis.map((r) => r.id) });
    }
  }
  return {
    assignments,
    employees: employees.map(({ id, displayName }) => ({ id, displayName })),
    works,
    reviews: reviews.map(({ id, workId, verdict, reason, decidedBy, decidedAt }) => ({ id, workId, verdict, reason, decidedBy, decidedAt })),
    decisions,
    resets,
    corrections: await readCorrections(db, identity),
    proposals,
    guidelines: (await listGuidelines(db, identity)).map((g) => toLedgerGuideline(g, language)),
  };
}

// 守則的文字換成目前語言（demo 以外是資料庫的原文）：提出時的文字與各次修改後的文字
function toLedgerGuideline(g: StoredGuideline, language: LanguageCode): LedgerGuideline {
  return {
    id: g.id,
    employeeId: g.employeeId,
    workTypeId: g.workTypeId,
    sourceAssignmentId: g.sourceAssignmentId,
    proposerKind: g.proposerKind,
    proposedBy: g.proposedBy,
    proposedAt: g.proposedAt,
    text: proposedText(g, language),
    decisions: g.decisions.map(({ id, decision, revisedText, decidedBy, decidedAt }) => ({
      id,
      decision,
      revisedText: revisionText({ id, revisedText }, language),
      decidedBy,
      decidedAt,
    })),
  };
}

/** 目前身分看得到的帳本，依時間新到舊。guest 與沒有身分時是空陣列。 */
export async function readLedger(db: Database, identity: string | null, language: LanguageCode): Promise<LedgerEvent[]> {
  return mergeLedger(await readLedgerSources(db, identity, language), language);
}
