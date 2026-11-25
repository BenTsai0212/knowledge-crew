// crew 的資料存取（#29 計畫第 1 節）。一律經 withIdentity() 讀寫，RLS 照常套用，不使用 superuser 連線。
// 讀取：看不到的資料回傳空結果（RLS 的行為）。寫入：不傳時間欄位與 assigned_by／decided_by（由資料庫預設），
// 權限不足時資料庫的錯誤原樣拋出。時間一律轉成 ISO 8601 字串。
import type { Transaction } from "@electric-sql/pglite";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { nameKeys } from "../../extraction/merge";
import {
  canBeGuideline, canDecide, currentText, guidelineStatus,
  type GuidelineDecision, type GuidelineDecisionKind, type GuidelineStatus, type ProposerKind,
} from "../guidelines/status";
import { flowbackDocumentId, flowbackOwnerPendingId, OWNER_ENTITY_TYPE, toFlowbackDocument } from "../knowledge/flowback";
import { guidelineDocumentId, identityName, toGuidelineDocument, type GuidelineDocument } from "../knowledge/guideline-document";
import type { LevelDecision, LevelDecisionKind, ReturnReason, Review, Verdict, WorkChange, WorkCheck, WorkForReview } from "../trust/types";

/** 工作來源的類型（RFC 0001 的 2026-11-21 修訂）；repo 類的外部編號是 Issue／PR 編號。 */
export type SourceKind = "repo" | "mailbox" | "social" | "knowledge_base";

export const SOURCE_KINDS: readonly SourceKind[] = ["repo", "mailbox", "social", "knowledge_base"];

/** 交辦的優先順序（#133）；沒有指定時是 normal。 */
export type Priority = "high" | "normal" | "low";

export const PRIORITIES: readonly Priority[] = ["high", "normal", "low"];

export interface StoredSource {
  id: string;
  kind: SourceKind;
  name: string;
  projectId: string;
}

export interface StoredEmployee {
  id: string;
  displayName: string;
  roleNote: string | null;
}

export interface AssignmentSummary {
  id: string;
  sourceId: string;
  sourceKind: SourceKind;
  sourceName: string;
  /** repo 類是 Issue 編號（十進位文字）；其他類型可以沒有（null） */
  externalRef: string | null;
  title: string;
  workTypeId: string;
  employeeId: string;
  assignedBy: string;
  assignedAt: string;
  /** 到期日（YYYY-MM-DD，#133）；沒有到期日時是 null */
  dueAt: string | null;
  priority: Priority;
  /** 沒有交件時為 null */
  latestRound: number | null;
  /** 最新一輪尚未驗收（或沒有交件）時為 null */
  latestVerdict: Verdict | null;
}

/** 一次驗收，加上所屬的工作、備註與驗收者。 */
export type StoredReview = Review & { workId: string; note: string | null; decidedBy: string };

/** 一份工作（＝PR）；可直接交給 rules.ts 的 reviewFocus()。`checks` 是每個檢查最新一筆的狀態。 */
export interface StoredWork extends WorkForReview {
  id: string;
  round: number;
  /** repo 類是 PR 編號（十進位文字）；其他類型可以沒有（null） */
  externalRef: string | null;
  summary: string;
  submittedAt: string;
  review: StoredReview | null;
}

export interface TrustInputs {
  reviews: Review[];
  decisions: LevelDecision[];
}

const iso = (value: Date | string): string => new Date(value).toISOString();

const read = <T>(db: Database, identityId: string | null, fn: (tx: Transaction) => Promise<T>) => db.withIdentity(identityId, fn);

async function rows<T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

export function listSources(db: Database, identityId: string | null): Promise<StoredSource[]> {
  return read(db, identityId, (tx) =>
    rows<StoredSource>(tx, `SELECT id, kind, name, project_id AS "projectId" FROM crew.sources ORDER BY name`),
  );
}

export function listEmployees(db: Database, identityId: string | null): Promise<StoredEmployee[]> {
  return read(db, identityId, (tx) =>
    rows<StoredEmployee>(tx, `SELECT id, display_name AS "displayName", role_note AS "roleNote" FROM crew.employees ORDER BY id`),
  );
}

/** 交辦清單，依交辦時間新到舊。 */
export function listAssignments(db: Database, identityId: string | null): Promise<AssignmentSummary[]> {
  return read(db, identityId, async (tx) => {
    const result = await rows<Omit<AssignmentSummary, "assignedAt"> & { assignedAt: Date }>(
      tx,
      `SELECT a.id, a.source_id AS "sourceId", s.kind AS "sourceKind", s.name AS "sourceName", a.external_ref AS "externalRef", a.title,
              a.work_type_id AS "workTypeId", a.employee_id AS "employeeId", a.assigned_by AS "assignedBy",
              a.assigned_at AS "assignedAt", to_char(a.due_at, 'YYYY-MM-DD') AS "dueAt", a.priority, lw.round AS "latestRound", rv.verdict AS "latestVerdict"
       FROM crew.assignments a
       JOIN crew.sources s ON s.id = a.source_id
       LEFT JOIN LATERAL (
         SELECT w.id, w.round FROM crew.works w WHERE w.assignment_id = a.id ORDER BY w.round DESC LIMIT 1
       ) lw ON true
       LEFT JOIN crew.reviews rv ON rv.work_id = lw.id
       ORDER BY a.assigned_at DESC, a.id DESC`,
    );
    return result.map((a) => ({ ...a, assignedAt: iso(a.assignedAt) }));
  });
}

interface ReviewRow {
  id: string;
  workId: string;
  verdict: Verdict;
  reason: ReturnReason | null;
  note: string | null;
  decidedBy: string;
  decidedAt: Date;
}

const REVIEW_COLUMNS = `rv.id, rv.work_id AS "workId", rv.verdict, rv.reason, rv.note, rv.decided_by AS "decidedBy", rv.decided_at AS "decidedAt"`;

function toStoredReview(r: ReviewRow): StoredReview {
  const base = { id: r.id, workId: r.workId, note: r.note, decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt) };
  // 資料表的 CHECK 保證 returned ⇔ reason 有值
  return r.verdict === "returned" ? { ...base, verdict: "returned", reason: r.reason! } : { ...base, verdict: "accepted", reason: null };
}

const toReview = ({ id, verdict, reason, decidedAt }: StoredReview): Review =>
  (verdict === "returned" ? { id, verdict, reason, decidedAt } : { id, verdict, reason: null, decidedAt });

/** 某交辦的各輪工作（依 round 排序），含要看的重點、變更、各檢查最新一筆的狀態與驗收。 */
export function getAssignmentWorks(db: Database, identityId: string | null, assignmentId: string): Promise<StoredWork[]> {
  return read(db, identityId, async (tx) => {
    const works = await rows<{ id: string; round: number; externalRef: string | null; summary: string; body: string; submittedAt: Date }>(
      tx,
      `SELECT id, round, external_ref AS "externalRef", summary, body, submitted_at AS "submittedAt"
       FROM crew.works WHERE assignment_id = $1 ORDER BY round`,
      [assignmentId],
    );
    const result: StoredWork[] = [];
    for (const w of works) {
      const points = await rows<{ text: string }>(tx, "SELECT text FROM crew.work_points WHERE work_id = $1 ORDER BY ordinal", [w.id]);
      const changes = await rows<WorkChange>(tx, "SELECT path, summary FROM crew.work_changes WHERE work_id = $1 ORDER BY ordinal", [w.id]);
      // 每個檢查取 checked_at 最新、同時間 id 最大的一筆
      const checks = await rows<WorkCheck>(
        tx,
        `SELECT name, status FROM (
           SELECT DISTINCT ON (name) name, status FROM crew.work_checks WHERE work_id = $1 ORDER BY name, checked_at DESC, id DESC
         ) latest ORDER BY name`,
        [w.id],
      );
      const review = await rows<ReviewRow>(tx, `SELECT ${REVIEW_COLUMNS} FROM crew.reviews rv WHERE rv.work_id = $1`, [w.id]);
      result.push({
        ...w,
        submittedAt: iso(w.submittedAt),
        points: points.map((p) => p.text),
        changes,
        checks,
        review: review[0] ? toStoredReview(review[0]) : null,
      });
    }
    return result;
  });
}

/** 驗收，依時間排序；可只取某交辦的驗收。 */
export function listReviews(db: Database, identityId: string | null, filter: { assignmentId?: string } = {}): Promise<StoredReview[]> {
  return read(db, identityId, async (tx) => {
    const result = await rows<ReviewRow>(
      tx,
      `SELECT ${REVIEW_COLUMNS} FROM crew.reviews rv JOIN crew.works w ON w.id = rv.work_id
       WHERE $1::text IS NULL OR w.assignment_id = $1
       ORDER BY rv.decided_at, rv.id`,
      [filter.assignmentId ?? null],
    );
    return result.map(toStoredReview);
  });
}

/** 某員工 × 某類工作的驗收與看重點的決定（依時間排序），直接交給 rules.ts。只含目前身分看得到的驗收。 */
export function getTrustInputs(db: Database, identityId: string | null, employeeId: string, workTypeId: string): Promise<TrustInputs> {
  return read(db, identityId, async (tx) => {
    const reviews = await rows<ReviewRow>(
      tx,
      `SELECT ${REVIEW_COLUMNS} FROM crew.reviews rv
       JOIN crew.works w ON w.id = rv.work_id
       JOIN crew.assignments a ON a.id = w.assignment_id
       WHERE a.employee_id = $1 AND a.work_type_id = $2
       ORDER BY rv.decided_at, rv.id`,
      [employeeId, workTypeId],
    );
    const decisions = await rows<{ decision: LevelDecisionKind; decidedAt: Date }>(
      tx,
      `SELECT decision, decided_at AS "decidedAt" FROM crew.level_decisions
       WHERE employee_id = $1 AND work_type_id = $2 ORDER BY decided_at, id`,
      [employeeId, workTypeId],
    );
    return {
      reviews: reviews.map((r) => toReview(toStoredReview(r))),
      decisions: decisions.map((d) => ({ decision: d.decision, decidedAt: iso(d.decidedAt) })),
    };
  });
}

// repo 類的外部編號：數字文字的最大值 ＋1（沒有時是 1）；不是數字的值不轉型、不計入
const NEXT_NUMBER = (column: string) => `coalesce(max(CASE WHEN ${column} ~ '^[0-9]+$' THEN ${column}::int END), 0) + 1`;

async function sourceKind(tx: Transaction, sourceId: string): Promise<SourceKind | null> {
  const found = await rows<{ kind: SourceKind }>(tx, "SELECT kind FROM crew.sources WHERE id = $1", [sourceId]);
  return found[0]?.kind ?? null;
}

/**
 * 該來源下一份工作的外部編號：repo 類是目前看得到的最大 PR 編號 ＋1（沒有時是 "1"），其他類型（或看不到的來源）是 null。
 */
export function nextExternalRef(db: Database, identityId: string | null, sourceId: string): Promise<string | null> {
  return read(db, identityId, async (tx) => {
    if ((await sourceKind(tx, sourceId)) !== "repo") return null;
    const [{ next }] = await rows<{ next: number }>(
      tx,
      `SELECT ${NEXT_NUMBER("w.external_ref")} AS next
       FROM crew.works w JOIN crew.assignments a ON a.id = w.assignment_id WHERE a.source_id = $1`,
      [sourceId],
    );
    return String(next);
  });
}

// 寫入不使用 RETURNING：值由這裡產生，不依賴寫入後的 SELECT policy

export interface NewAssignment {
  sourceId: string;
  title: string;
  workTypeId: string;
  employeeId: string;
  /** 到期日（YYYY-MM-DD，#133）；省略或 null 時沒有到期日 */
  dueAt?: string | null;
  /** 省略時是 normal */
  priority?: Priority;
}

/** 新增交辦；repo 類的外部編號（Issue 編號）取該來源目前最大值 ＋1，其他類型是 null。 */
export function createAssignment(
  db: Database,
  identityId: string | null,
  input: NewAssignment,
): Promise<{ id: string; externalRef: string | null }> {
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    let externalRef: string | null = null;
    if ((await sourceKind(tx, input.sourceId)) === "repo") {
      const [{ next }] = await rows<{ next: number }>(
        tx,
        `SELECT ${NEXT_NUMBER("external_ref")} AS next FROM crew.assignments WHERE source_id = $1`,
        [input.sourceId],
      );
      externalRef = String(next);
    }
    await tx.query(
      "INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, due_at, priority) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, input.sourceId, externalRef, input.title, input.workTypeId, input.employeeId, input.dueAt ?? null, input.priority ?? "normal"],
    );
    return { id, externalRef };
  });
}

export interface NewWork {
  assignmentId: string;
  /** nextExternalRef() 的值；沒有外部編號時是 null */
  externalRef: string | null;
  summary: string;
  body: string;
  points: string[];
  changes: WorkChange[];
  /** 同名可有多筆，依序寫入：同一交易的時間相同，最新一筆由自動編號的 id 決定 */
  checks: WorkCheck[];
  /** 這次依照的守則（員工自述，ADR 0007 決定 5）；只能是同一員工 × 工作類型、交件當時生效的守則（RLS 檢查） */
  guidelineIds?: string[];
}

/** 新增一份工作（交件）；round 取該交辦目前最大值 ＋1。 */
export function createWork(db: Database, identityId: string | null, input: NewWork): Promise<{ id: string; round: number }> {
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    const [{ next }] = await rows<{ next: number }>(
      tx,
      "SELECT coalesce(max(round), 0)::int + 1 AS next FROM crew.works WHERE assignment_id = $1",
      [input.assignmentId],
    );
    await tx.query(
      "INSERT INTO crew.works (id, assignment_id, round, external_ref, summary, body) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, input.assignmentId, next, input.externalRef, input.summary, input.body],
    );
    for (const [i, text] of input.points.entries()) {
      await tx.query("INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ($1, $2, $3)", [id, i + 1, text]);
    }
    for (const [i, c] of input.changes.entries()) {
      await tx.query("INSERT INTO crew.work_changes (work_id, ordinal, path, summary) VALUES ($1, $2, $3, $4)", [id, i + 1, c.path, c.summary]);
    }
    for (const c of input.checks) {
      await tx.query("INSERT INTO crew.work_checks (work_id, name, status) VALUES ($1, $2, $3)", [id, c.name, c.status]);
    }
    for (const guidelineId of input.guidelineIds ?? []) {
      await tx.query(
        `INSERT INTO crew.work_guidelines (work_id, guideline_id, assignment_id, employee_id, work_type_id)
         SELECT $1, $2, a.id, a.employee_id, a.work_type_id FROM crew.assignments a WHERE a.id = $3`,
        [id, guidelineId, input.assignmentId],
      );
    }
    return { id, round: next };
  });
}

/**
 * `saveAsGuideline`：退回時把意見記成守則（ADR 0007 決定 2，人提＝確認）。原因是「流程上的小問題」或意見是空的時，
 * 拋出 GuidelineError（`not-eligible`），驗收也不寫入。
 */
export type NewReview = { workId: string; note?: string } & (
  | { verdict: "accepted" }
  | { verdict: "returned"; reason: ReturnReason; saveAsGuideline?: boolean }
);

/**
 * 驗收「通過」時知識庫條目的回流（#92）：`flowed` 已收進知識庫；`not-applicable` 不需要回流（退回、來源沒有回流等級、
 * 全文不是一個知識庫條目）；`no-upload-permission` 驗收者沒有上傳權限，驗收照常通過、不回流（#92 的 `## 決定` 4）。
 */
export type FlowbackOutcome = "flowed" | "not-applicable" | "no-upload-permission";

export interface ReviewOptions {
  /** 交件全文的語言（works.body 存 defaultLanguage）；回流文件與段落的語言 */
  language?: LanguageCode;
  /** 回流文件的日期（YYYY-MM-DD）；預設是執行當下的本地日期（＝驗收日） */
  date?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 寫入驗收。「通過」且是要回流的知識庫條目時，在同一個交易中寫入文件、段落、`#owner` 的部門實體與 crew.knowledge_flowbacks（writeFlowback()）；
 * 寫入一律受 RLS 檢查（knowledge-kit 的上傳規則與 crew 0005 的 policy），任一步被拒絕時整筆驗收回滾。
 */
export function createReview(
  db: Database,
  identityId: string | null,
  input: NewReview,
  options: ReviewOptions = {},
): Promise<{ id: string; flowback: FlowbackOutcome; guidelineId: string | null; guidelineDocument: GuidelineDocumentOutcome }> {
  const asGuideline = input.verdict === "returned" && input.saveAsGuideline === true;
  if (asGuideline && !canBeGuideline(input.reason, input.note)) {
    return Promise.reject(new GuidelineError("not-eligible", "only a return with reason wrong or different_approach and a non-empty note can become a guideline"));
  }
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    const reason = input.verdict === "returned" ? input.reason : null;
    await tx.query("INSERT INTO crew.reviews (id, work_id, verdict, reason, note) VALUES ($1, $2, $3, $4, $5)", [
      id, input.workId, input.verdict, reason, input.note ?? null,
    ]);
    const flowback = input.verdict === "accepted" ? await flowBack(tx, id, input.workId, options) : "not-applicable";
    let guidelineId: string | null = null;
    let guidelineDocument: GuidelineDocumentOutcome = "not-applicable";
    if (asGuideline) {
      guidelineId = await insertGuideline(tx, id, input.note!, "human");
      const confirmId = crypto.randomUUID();
      await tx.query("INSERT INTO crew.guideline_decisions (id, guideline_id, decision) VALUES ($1, $2, 'confirm')", [confirmId, guidelineId]);
      guidelineDocument = await documentGuideline(tx, guidelineId, confirmId, options);
    }
    return { id, flowback, guidelineId, guidelineDocument };
  });
}

async function flowBack(tx: Transaction, reviewId: string, workId: string, options: ReviewOptions): Promise<FlowbackOutcome> {
  const [work] = await rows<{ body: string; projectId: string; level: string | null }>(
    tx,
    `SELECT w.body, s.project_id AS "projectId", s.knowledge_visibility_level_id AS level
     FROM crew.works w JOIN crew.assignments a ON a.id = w.assignment_id JOIN crew.sources s ON s.id = a.source_id
     WHERE w.id = $1`,
    [workId],
  );
  if (!work || work.level === null) return "not-applicable";
  if (!toFlowbackDocument(work.body)) return "not-applicable";
  const [{ canUpload, actor }] = await rows<{ canUpload: boolean; actor: string }>(
    tx,
    `SELECT kk.can_upload() AS "canUpload", kk.current_identity_id() AS actor`,
  );
  if (!canUpload) return "no-upload-permission";
  await writeFlowback(tx, {
    reviewId, workId, body: work.body, projectId: work.projectId, level: work.level, actor,
    language: options.language ?? clientConfig.client.defaultLanguage, date: options.date ?? localDate(new Date()),
  });
  return "flowed";
}

export interface FlowbackWrite {
  reviewId: string;
  workId: string;
  /** 交件全文（不是一個知識庫條目時不寫入任何資料） */
  body: string;
  projectId: string;
  level: string;
  /** 上傳者與核准者（＝驗收者）；以 kk_app 寫入時必須是目前身分，RLS 檢查 */
  actor: string;
  language: LanguageCode;
  /** 文件日期（YYYY-MM-DD） */
  date: string;
  /** 回流紀錄的時間；不傳時由資料庫預設（kk_app 不能指定，只有 seed 以 superuser 寫入時傳） */
  at?: string;
}

/**
 * 回流的寫入（createReview() 與 demo 的 seed 共用）：文件與段落（上傳的寫入規則），`#owner` 欄位對到部門實體
 * （待審實體 → 人做的核准（manual，核准者＝驗收者）→ 正式實體或合併到既有部門，與出處；#92 的 `## 決定` 3），
 * 最後是 crew.knowledge_flowbacks。以 kk_app 寫入時每一列都受 RLS 檢查；回傳寫入的文件 id，不是知識庫條目時是 null。
 */
export async function writeFlowback(tx: Transaction, input: FlowbackWrite): Promise<string | null> {
  const doc = toFlowbackDocument(input.body);
  if (!doc) return null;
  const { actor, language, level, projectId } = input;
  const documentId = flowbackDocumentId(input.workId);
  // 與上傳（upload/write.ts）相同的寫法：段落 id 是「文件 id-序號」、ordinal 從 0 開始
  await tx.query(
    `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, document_date, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [documentId, doc.title, language, level, projectId, input.date, actor],
  );
  const passageId = (i: number) => `${documentId}-${i + 1}`;
  for (const [i, content] of doc.passages.entries()) {
    await tx.query(
      `INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [passageId(i), documentId, i, language, content, level, projectId],
    );
  }
  if (doc.owner) await writeOwner(tx, input, documentId, doc.owner.name, passageId(doc.owner.passage));
  await tx.query(
    `INSERT INTO crew.knowledge_flowbacks (review_id, document_id${input.at ? ", created_at" : ""}) VALUES ($1, $2${input.at ? ", $3" : ""})`,
    input.at ? [input.reviewId, documentId, input.at] : [input.reviewId, documentId],
  );
  return documentId;
}

/**
 * `#owner` → 部門實體。合併對象是寫入者看得到、名稱依 aliasRules 相同的部門（extraction/merge.ts 的 nameKeys()）：
 * 剛好一個時合併（加上出處），沒有時新建；兩個以上時無法自動選擇，不寫進圖譜（段落照常回流）。
 * 寫法與 knowledge-kit 的核准（extraction/store.ts 的 approveEntity()）相同，受 0006／0009／0013 的 policy 檢查。
 */
async function writeOwner(tx: Transaction, input: FlowbackWrite, documentId: string, name: string, passageId: string): Promise<void> {
  const entityTypes = clientConfig.knowledgeModel.entityTypes;
  if (!entityTypes.some((t) => t.id === OWNER_ENTITY_TYPE)) return;
  const keys = nameKeys(OWNER_ENTITY_TYPE, [name], entityTypes);
  const teams = await rows<{ id: string; name: string; names: Record<string, string> }>(
    tx,
    "SELECT id, name, names FROM kk.entities WHERE entity_type = $1 ORDER BY id",
    [OWNER_ENTITY_TYPE],
  );
  const candidates = teams.filter((e) => [...nameKeys(OWNER_ENTITY_TYPE, [e.name, ...Object.values(e.names)], entityTypes)].some((k) => keys.has(k)));
  if (candidates.length > 1) return;
  const mergeInto = candidates[0]?.id ?? null;

  const pendingId = flowbackOwnerPendingId(input.workId);
  const names = { [input.language]: name };
  await tx.query("INSERT INTO kk.pending_entities (id, document_id, entity_type, names) VALUES ($1, $2, $3, $4)", [
    pendingId, documentId, OWNER_ENTITY_TYPE, names,
  ]);
  await tx.query("INSERT INTO kk.pending_entity_sources (pending_entity_id, document_id, passage_id) VALUES ($1, $2, $3)", [
    pendingId, documentId, passageId,
  ]);
  // 新的待審項目：第 1 筆決定，id 等於項目 id（0009）
  await tx.query(
    `INSERT INTO kk.review_decisions (item_id, round, decision, decided_by, merge_into, mode) VALUES ($1, 1, 'approve', $2, $3, 'manual')`,
    [pendingId, input.actor, mergeInto],
  );
  const entityId = mergeInto ?? pendingId;
  if (mergeInto === null) {
    await tx.query("INSERT INTO kk.entities (id, entity_type, name, names) VALUES ($1, $2, $3, $4)", [pendingId, OWNER_ENTITY_TYPE, name, names]);
  }
  await tx.query("INSERT INTO kk.entity_sources (entity_id, passage_id, decision_id) VALUES ($1, $2, $3)", [entityId, passageId, pendingId]);
}

export interface NewLevelDecision {
  employeeId: string;
  workTypeId: string;
  decision: LevelDecisionKind;
  basisReviewId?: string;
}

export function createLevelDecision(db: Database, identityId: string | null, input: NewLevelDecision): Promise<{ id: string }> {
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    await tx.query(
      "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, basis_review_id) VALUES ($1, $2, $3, $4, $5)",
      [id, input.employeeId, input.workTypeId, input.decision, input.basisReviewId ?? null],
    );
    return { id };
  });
}

// ── 守則（crew ADR 0007、#142） ──────────────────────────────────────────

export type GuidelineErrorCode = "not-eligible" | "not-found" | "invalid-transition";

/** 寫入守則前的檢查失敗（資料庫也會擋，這裡先給清楚的錯誤）。 */
export class GuidelineError extends Error {
  constructor(readonly code: GuidelineErrorCode, message: string) {
    super(message);
    this.name = "GuidelineError";
  }
}

export type StoredGuidelineDecision = GuidelineDecision & { id: string; decidedBy: string };

export interface StoredGuideline {
  id: string;
  employeeId: string;
  workTypeId: string;
  /** 提出的文字 */
  text: string;
  /** 目前的文字（確認時修改過就是修改後的文字） */
  currentText: string;
  status: GuidelineStatus;
  sourceReviewId: string;
  sourceWorkId: string;
  sourceAssignmentId: string;
  /** 來源退回；看不到來源交辦時是 null（守則的可見範圍是員工 × 工作類型，與交辦的來源無關） */
  sourceReview: StoredReview | null;
  proposerKind: ProposerKind;
  /** 人提時是提出的人；員工提出時是 null */
  proposedBy: string | null;
  proposedAt: string;
  /** 依時間排序 */
  decisions: StoredGuidelineDecision[];
}

// 來源的交件、交辦與員工 × 工作類型由來源退回查出（複合外鍵再檢查一次）；看不到或不能成為守則時拋出 GuidelineError
async function insertGuideline(tx: Transaction, reviewId: string, text: string, proposer: ProposerKind): Promise<string> {
  const [source] = await rows<{ workId: string; assignmentId: string; employeeId: string; workTypeId: string; reason: ReturnReason | null; note: string | null }>(
    tx,
    `SELECT w.id AS "workId", a.id AS "assignmentId", a.employee_id AS "employeeId", a.work_type_id AS "workTypeId", rv.reason, rv.note
     FROM crew.reviews rv JOIN crew.works w ON w.id = rv.work_id JOIN crew.assignments a ON a.id = w.assignment_id
     WHERE rv.id = $1`,
    [reviewId],
  );
  if (!source) throw new GuidelineError("not-found", `review ${reviewId} not found`);
  if (!canBeGuideline(source.reason, source.note)) throw new GuidelineError("not-eligible", `review ${reviewId} cannot become a guideline`);
  const id = crypto.randomUUID();
  await tx.query(
    `INSERT INTO crew.guidelines (id, employee_id, work_type_id, text, source_review_id, source_work_id, source_assignment_id, proposer_kind, proposed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'human' THEN kk.current_identity_id() END)`,
    [id, source.employeeId, source.workTypeId, text, reviewId, source.workId, source.assignmentId, proposer],
  );
  return id;
}

/** AI 員工從一次退回整理出守則，等人決定（demo 的匯入與之後的員工提案用）。 */
export function proposeGuideline(db: Database, identityId: string | null, input: { sourceReviewId: string; text: string }): Promise<{ id: string }> {
  return db.withIdentity(identityId, async (tx) => ({ id: await insertGuideline(tx, input.sourceReviewId, input.text, "employee") }));
}

export type NewGuidelineDecision = { guidelineId: string } & (
  | { decision: "confirm"; revisedText?: string }
  | { decision: Exclude<GuidelineDecisionKind, "confirm"> }
);

/**
 * 寫入人的決定；先以目前的決定判斷能不能做（canDecide()），不能時拋出 GuidelineError，不寫入。
 * 確認時在同一個交易寫入守則的文件（writeGuidelineDocument()，#149）；不採用、收回不寫，收回也不刪、不改文件。
 */
export function decideGuideline(
  db: Database,
  identityId: string | null,
  input: NewGuidelineDecision,
  options: ReviewOptions = {},
): Promise<{ id: string; guidelineDocument: GuidelineDocumentOutcome }> {
  return db.withIdentity(identityId, async (tx) => {
    const [guideline] = await loadGuidelines(tx, "g.id = $1", [input.guidelineId]);
    if (!guideline) throw new GuidelineError("not-found", `guideline ${input.guidelineId} not found`);
    if (!canDecide(guideline.decisions, input.decision)) {
      throw new GuidelineError("invalid-transition", `guideline ${input.guidelineId} is ${guideline.status}; cannot ${input.decision}`);
    }
    const id = crypto.randomUUID();
    const revisedText = input.decision === "confirm" ? (input.revisedText ?? null) : null;
    // 收回指向那筆確認（crew/0007 的外鍵）
    const confirmId = input.decision === "revoke" ? (guideline.decisions.find((d) => d.decision === "confirm")?.id ?? null) : null;
    await tx.query("INSERT INTO crew.guideline_decisions (id, guideline_id, decision, revised_text, confirm_id) VALUES ($1, $2, $3, $4, $5)", [
      id, input.guidelineId, input.decision, revisedText, confirmId,
    ]);
    const guidelineDocument = input.decision === "confirm" ? await documentGuideline(tx, input.guidelineId, id, options) : "not-applicable";
    return { id, guidelineDocument };
  });
}

/**
 * 守則確認時寫成知識庫文件（#149）：`written` 已寫入；`not-applicable` 不需要寫（不是確認、來源沒有守則等級、看不到來源交辦）；
 * `no-upload-permission` 確認者沒有上傳權限，確認照常寫入、守則照常生效，只是不寫文件（比照回流）。
 */
export type GuidelineDocumentOutcome = "written" | "not-applicable" | "no-upload-permission";

// 寫入文件需要的資料：守則、來源交辦的工作來源（專案與守則等級）、來源退回、這次確認
async function documentGuideline(tx: Transaction, guidelineId: string, confirmId: string, options: ReviewOptions): Promise<GuidelineDocumentOutcome> {
  const [row] = await rows<{
    text: string; proposerKind: ProposerKind; employeeName: string; workTypeId: string; projectId: string; level: string | null;
    reason: ReturnReason; returnedAt: Date; revisedText: string | null; confirmedBy: string; confirmedAt: Date;
  }>(
    tx,
    `SELECT g.text, g.proposer_kind AS "proposerKind", e.display_name AS "employeeName", g.work_type_id AS "workTypeId",
            s.project_id AS "projectId", s.guideline_visibility_level_id AS level, rv.reason, rv.decided_at AS "returnedAt",
            gd.revised_text AS "revisedText", gd.decided_by AS "confirmedBy", gd.decided_at AS "confirmedAt"
     FROM crew.guidelines g
     JOIN crew.employees e ON e.id = g.employee_id
     JOIN crew.assignments a ON a.id = g.source_assignment_id
     JOIN crew.sources s ON s.id = a.source_id
     JOIN crew.reviews rv ON rv.id = g.source_review_id
     JOIN crew.guideline_decisions gd ON gd.guideline_id = g.id AND gd.id = $2 AND gd.decision = 'confirm'
     WHERE g.id = $1`,
    [guidelineId, confirmId],
  );
  if (!row || row.level === null) return "not-applicable";
  const [{ canUpload }] = await rows<{ canUpload: boolean }>(tx, `SELECT kk.can_upload() AS "canUpload"`);
  if (!canUpload) return "no-upload-permission";
  const language = options.language ?? clientConfig.client.defaultLanguage;
  const confirmDate = options.date ?? localDate(new Date(row.confirmedAt));
  const doc = toGuidelineDocument({
    employeeName: row.employeeName, workTypeId: row.workTypeId, text: row.revisedText ?? row.text, proposerKind: row.proposerKind,
    returnDate: localDate(new Date(row.returnedAt)), reason: row.reason,
    confirmerName: identityName(clientConfig.access, row.confirmedBy, language), confirmDate, revised: row.revisedText !== null,
  }, language);
  await writeGuidelineDocument(tx, {
    guidelineId, confirmId, doc, projectId: row.projectId, level: row.level, actor: row.confirmedBy, language, date: confirmDate,
  });
  return "written";
}

export interface GuidelineDocumentWrite {
  guidelineId: string;
  /** 依據的那筆確認（crew.guideline_documents 的外鍵） */
  confirmId: string;
  doc: GuidelineDocument;
  projectId: string;
  level: string;
  /** 上傳者（＝確認者）；以 kk_app 寫入時必須是目前身分，RLS 檢查 */
  actor: string;
  language: LanguageCode;
  /** 文件日期（YYYY-MM-DD，確認日） */
  date: string;
  /** 紀錄的時間；不傳時由資料庫預設（kk_app 不能指定，只有 seed 以 superuser 寫入時傳） */
  at?: string;
}

/**
 * 守則文件的寫入（decideGuideline()、createReview() 與 demo 的 seed 共用；比照 writeFlowback()）：
 * 文件 → 段落（上傳的寫法：段落 id 是「文件 id-序號」、ordinal 從 0 開始）→ crew.guideline_documents。以 kk_app 寫入時每一列都受 RLS 檢查。
 */
export async function writeGuidelineDocument(tx: Transaction, input: GuidelineDocumentWrite): Promise<string> {
  const { actor, language, level, projectId, doc } = input;
  const documentId = guidelineDocumentId(input.guidelineId);
  await tx.query(
    `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, document_date, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [documentId, doc.title, language, level, projectId, input.date, actor],
  );
  for (const [i, content] of doc.passages.entries()) {
    await tx.query(
      `INSERT INTO kk.passages (id, document_id, ordinal, language, content, visibility_level_id, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`${documentId}-${i + 1}`, documentId, i, language, content, level, projectId],
    );
  }
  await tx.query(
    `INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id${input.at ? ", created_at" : ""}) VALUES ($1, $2, $3${input.at ? ", $4" : ""})`,
    input.at ? [input.guidelineId, documentId, input.confirmId, input.at] : [input.guidelineId, documentId, input.confirmId],
  );
  return documentId;
}

async function loadGuidelines(tx: Transaction, where: string, params: unknown[]): Promise<StoredGuideline[]> {
  const found = await rows<Omit<StoredGuideline, "currentText" | "status" | "sourceReview" | "decisions" | "proposedAt"> & { proposedAt: Date }>(
    tx,
    `SELECT g.id, g.employee_id AS "employeeId", g.work_type_id AS "workTypeId", g.text, g.source_review_id AS "sourceReviewId",
            g.source_work_id AS "sourceWorkId", g.source_assignment_id AS "sourceAssignmentId", g.proposer_kind AS "proposerKind",
            g.proposed_by AS "proposedBy", g.proposed_at AS "proposedAt"
     FROM crew.guidelines g WHERE ${where} ORDER BY g.proposed_at, g.id`,
    params,
  );
  const result: StoredGuideline[] = [];
  for (const g of found) {
    const decisions = (await rows<Omit<StoredGuidelineDecision, "decidedAt"> & { decidedAt: Date }>(
      tx,
      `SELECT id, decision, revised_text AS "revisedText", decided_by AS "decidedBy", decided_at AS "decidedAt"
       FROM crew.guideline_decisions WHERE guideline_id = $1 ORDER BY decided_at, id`,
      [g.id],
    )).map((d) => ({ ...d, decidedAt: iso(d.decidedAt) }));
    const review = await rows<ReviewRow>(tx, `SELECT ${REVIEW_COLUMNS} FROM crew.reviews rv WHERE rv.id = $1`, [g.sourceReviewId]);
    result.push({
      ...g,
      proposedAt: iso(g.proposedAt),
      currentText: currentText(g.text, decisions),
      status: guidelineStatus(decisions),
      sourceReview: review[0] ? toStoredReview(review[0]) : null,
      decisions,
    });
  }
  return result;
}

/** 守則（依提出時間排序），含來源退回、決定歷程、推算的狀態與目前的文字；可只取某員工、某工作類型。 */
export function listGuidelines(
  db: Database,
  identityId: string | null,
  filter: { employeeId?: string; workTypeId?: string } = {},
): Promise<StoredGuideline[]> {
  return read(db, identityId, (tx) =>
    loadGuidelines(tx, "($1::text IS NULL OR g.employee_id = $1) AND ($2::text IS NULL OR g.work_type_id = $2)", [
      filter.employeeId ?? null, filter.workTypeId ?? null,
    ]),
  );
}

/** 一次交件依照的守則（員工自述）。 */
export function listWorkGuidelines(db: Database, identityId: string | null, workId: string): Promise<StoredGuideline[]> {
  return read(db, identityId, (tx) =>
    loadGuidelines(tx, "g.id IN (SELECT wg.guideline_id FROM crew.work_guidelines wg WHERE wg.work_id = $1)", [workId]),
  );
}
