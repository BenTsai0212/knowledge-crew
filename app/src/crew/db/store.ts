// crew 的資料存取（#29 計畫第 1 節）。一律經 withIdentity() 讀寫，RLS 照常套用，不使用 superuser 連線。
// 讀取：看不到的資料回傳空結果（RLS 的行為）。寫入：不傳時間欄位與 assigned_by／decided_by（由資料庫預設），
// 權限不足時資料庫的錯誤原樣拋出。時間一律轉成 ISO 8601 字串。
import type { Transaction } from "@electric-sql/pglite";
import type { Database } from "../../db/database";
import type { LevelDecision, LevelDecisionKind, ReturnReason, Review, Verdict, WorkChange, WorkCheck, WorkForReview } from "../trust/types";

export interface StoredRepo {
  id: string;
  fullName: string;
  projectId: string;
}

export interface StoredEmployee {
  id: string;
  displayName: string;
  roleNote: string | null;
}

export interface AssignmentSummary {
  id: string;
  repoId: string;
  repoFullName: string;
  issueNumber: number;
  title: string;
  workTypeId: string;
  employeeId: string;
  assignedBy: string;
  assignedAt: string;
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
  prNumber: number;
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

export function listRepos(db: Database, identityId: string | null): Promise<StoredRepo[]> {
  return read(db, identityId, (tx) =>
    rows<StoredRepo>(tx, `SELECT id, full_name AS "fullName", project_id AS "projectId" FROM crew.repos ORDER BY full_name`),
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
      `SELECT a.id, a.repo_id AS "repoId", r.full_name AS "repoFullName", a.issue_number AS "issueNumber", a.title,
              a.work_type_id AS "workTypeId", a.employee_id AS "employeeId", a.assigned_by AS "assignedBy",
              a.assigned_at AS "assignedAt", lw.round AS "latestRound", rv.verdict AS "latestVerdict"
       FROM crew.assignments a
       JOIN crew.repos r ON r.id = a.repo_id
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
    const works = await rows<{ id: string; round: number; prNumber: number; summary: string; body: string; submittedAt: Date }>(
      tx,
      `SELECT id, round, pr_number AS "prNumber", summary, body, submitted_at AS "submittedAt"
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

/** 某員工 × 某類工作的驗收與少看的決定（依時間排序），直接交給 rules.ts。只含目前身分看得到的驗收。 */
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

/** 該 repo 目前看得到的最大 PR 編號 ＋1（沒有時是 1）。 */
export function nextPrNumber(db: Database, identityId: string | null, repoId: string): Promise<number> {
  return read(db, identityId, async (tx) => {
    const [{ next }] = await rows<{ next: number }>(
      tx,
      `SELECT coalesce(max(w.pr_number), 0)::int + 1 AS next
       FROM crew.works w JOIN crew.assignments a ON a.id = w.assignment_id WHERE a.repo_id = $1`,
      [repoId],
    );
    return next;
  });
}

// 寫入不使用 RETURNING：值由這裡產生，不依賴寫入後的 SELECT policy

export interface NewAssignment {
  repoId: string;
  title: string;
  workTypeId: string;
  employeeId: string;
}

/** 新增交辦；issue_number 取該 repo 目前最大值 ＋1。 */
export function createAssignment(db: Database, identityId: string | null, input: NewAssignment): Promise<{ id: string; issueNumber: number }> {
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    const [{ next }] = await rows<{ next: number }>(
      tx,
      "SELECT coalesce(max(issue_number), 0)::int + 1 AS next FROM crew.assignments WHERE repo_id = $1",
      [input.repoId],
    );
    await tx.query(
      "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, input.repoId, next, input.title, input.workTypeId, input.employeeId],
    );
    return { id, issueNumber: next };
  });
}

export interface NewWork {
  assignmentId: string;
  prNumber: number;
  summary: string;
  body: string;
  points: string[];
  changes: WorkChange[];
  /** 同名可有多筆，依序寫入：同一交易的時間相同，最新一筆由自動編號的 id 決定 */
  checks: WorkCheck[];
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
      "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary, body) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, input.assignmentId, next, input.prNumber, input.summary, input.body],
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
    return { id, round: next };
  });
}

export type NewReview = { workId: string; note?: string } & ({ verdict: "accepted" } | { verdict: "returned"; reason: ReturnReason });

export function createReview(db: Database, identityId: string | null, input: NewReview): Promise<{ id: string }> {
  return db.withIdentity(identityId, async (tx) => {
    const id = crypto.randomUUID();
    const reason = input.verdict === "returned" ? input.reason : null;
    await tx.query("INSERT INTO crew.reviews (id, work_id, verdict, reason, note) VALUES ($1, $2, $3, $4, $5)", [
      id, input.workId, input.verdict, reason, input.note ?? null,
    ]);
    return { id };
  });
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
