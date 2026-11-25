// 回流文件的來源（#92 的計畫第 2 節與 `## 決定` 1）：知識庫的文件來自哪位 AI 員工、哪一次驗收。
// 知識的來歷（#147，crew ADR 0007 決定 8）：當時經過的把關，只從既有紀錄推算、不加欄位：
// 驗收者、當時的審查層級（通過那一刻以前的驗收與看重點的決定）、退回幾次後通過、通過那一輪的自動檢查、依照的守則數。
// 守則的文件（#149，ADR 0007 決定 7）：哪位員工、哪一次退回、誰確認、目前生效或已收回、之後依照幾次。
// 一律經 db.withIdentity()：回流紀錄看得到（驗收與文件都看得到，crew 0005 的 policy）、守則的文件紀錄看得到
// （守則與文件都看得到，crew 0008 的 policy）時才有，否則是 null。一份文件只會是其中一種（id 的格式不同）。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { getAssignmentWorks, getTrustInputs, listGuidelines, listReviews, listWorkGuidelines } from "../db/store";
import type { ProposerKind } from "../guidelines/status";
import { guidelineTexts } from "../ui/guideline-text";
import type { ReturnReason } from "../trust/types";
import { demoText } from "../demo/texts";
import { reviewLevel } from "../trust/rules";
import type { LevelDecision, Review, ReviewLevel, WorkCheck } from "../trust/types";

export interface FlowbackOrigin {
  /** 「工作與驗收」要選的交辦 */
  assignmentId: string;
  /** 交辦的標題（目前語言） */
  title: string;
  employeeName: string;
  /** 驗收時間（ISO） */
  decidedAt: string;
  /** 驗收者（client/access.json 的身分 id） */
  decidedBy: string;
  /** 當時的審查層級 */
  level: ReviewLevel;
  /** 同一交辦在通過之前被退回的次數 */
  returned: number;
  /** 通過那一輪每種檢查最後一次的結果；沒有自動檢查時是 null */
  checks: { passed: number; total: number } | null;
  /** 通過那一輪依照的守則數（員工自述） */
  guidelines: number;
}

interface OriginRow {
  assignmentId: string;
  title: string;
  employeeId: string;
  workTypeId: string;
  employeeName: string;
  workId: string;
  decidedBy: string;
  decidedAt: Date | string;
}

const ORIGIN_SQL = `SELECT a.id AS "assignmentId", a.title, a.employee_id AS "employeeId", a.work_type_id AS "workTypeId",
       e.display_name AS "employeeName", w.id AS "workId", rv.decided_by AS "decidedBy", rv.decided_at AS "decidedAt"
  FROM crew.knowledge_flowbacks f
  JOIN crew.reviews rv ON rv.id = f.review_id
  JOIN crew.works w ON w.id = rv.work_id
  JOIN crew.assignments a ON a.id = w.assignment_id
  JOIN crew.employees e ON e.id = a.employee_id`;

const time = (iso: string) => Date.parse(iso);

/**
 * 通過那一刻的審查層級：只用那一刻以前的驗收與看重點的決定（同員工 × 工作類型），交給 rules.ts 的 reviewLevel()。
 * 通過的那一次本身不算（它不會讓層級改變）。
 */
export function levelAt(reviews: readonly Review[], decisions: readonly LevelDecision[], at: string): ReviewLevel {
  const before = <T extends { decidedAt: string }>(items: readonly T[]) => items.filter((x) => time(x.decidedAt) < time(at));
  return reviewLevel(before(reviews), before(decisions));
}

/** 同一交辦在 `at`（通過的時間）之前被退回的次數 */
export const returnedBefore = (reviews: readonly Pick<Review, "verdict" | "decidedAt">[], at: string): number =>
  reviews.filter((r) => r.verdict === "returned" && time(r.decidedAt) < time(at)).length;

/** 自動檢查的通過數與總數（每種檢查最後一次的結果）；沒有檢查時是 null */
export function checkTally(checks: readonly WorkCheck[]): { passed: number; total: number } | null {
  if (checks.length === 0) return null;
  return { passed: checks.filter((c) => c.status === "pass").length, total: checks.length };
}

/** 文件 id → 來源與當時的把關；不是回流的文件、或目前身分看不到時是 null */
export async function readFlowbackOrigin(db: Database, identity: string | null, documentId: string, language: LanguageCode): Promise<FlowbackOrigin | null> {
  if (identity === null) return null;
  const row = await db.withIdentity(identity, async (tx) => (await tx.query<OriginRow>(`${ORIGIN_SQL} WHERE f.document_id = $1`, [documentId])).rows[0]);
  if (row === undefined) return null;
  const decidedAt = new Date(row.decidedAt).toISOString();
  const [trust, assignmentReviews, works, followed] = await Promise.all([
    getTrustInputs(db, identity, row.employeeId, row.workTypeId),
    listReviews(db, identity, { assignmentId: row.assignmentId }),
    getAssignmentWorks(db, identity, row.assignmentId),
    listWorkGuidelines(db, identity, row.workId),
  ]);
  return {
    assignmentId: row.assignmentId,
    title: demoText("title", row.assignmentId, language) ?? row.title,
    employeeName: row.employeeName,
    decidedAt,
    decidedBy: row.decidedBy,
    level: levelAt(trust.reviews, trust.decisions, decidedAt),
    returned: returnedBefore(assignmentReviews, decidedAt),
    checks: checkTally(works.find((w) => w.id === row.workId)?.checks ?? []),
    guidelines: followed.length,
  };
}

/** 工作 id → 回流文件的第一段（「已收進知識庫」打開原文用）；沒有回流、或目前身分看不到時是 null */
export async function readFlowbackPassage(db: Database, identity: string | null, workId: string): Promise<string | null> {
  if (identity === null) return null;
  return db.withIdentity(identity, async (tx) => {
    const rows = (
      await tx.query<{ id: string }>(
        `SELECT p.id FROM crew.knowledge_flowbacks f
         JOIN crew.reviews rv ON rv.id = f.review_id
         JOIN kk.passages p ON p.document_id = f.document_id
         WHERE rv.work_id = $1 ORDER BY p.ordinal LIMIT 1`,
        [workId],
      )
    ).rows;
    return rows[0]?.id ?? null;
  });
}

export interface GuidelineOrigin {
  guidelineId: string;
  employeeId: string;
  employeeName: string;
  workTypeId: string;
  /** 守則目前的文字（目前語言；確認時修改過就是修改後的文字） */
  text: string;
  proposerKind: ProposerKind;
  /** 來源交辦（「看那次退回」要選的交辦） */
  assignmentId: string;
  /** 來源退回的時間（ISO）與原因 */
  returnedAt: string;
  reason: ReturnReason;
  /** 確認者（client/access.json 的身分 id）與確認時間（ISO） */
  confirmedBy: string;
  confirmedAt: string;
  /** 確認時修改過 */
  revised: boolean;
  /** 已收回的時間（ISO）；生效中是 null */
  revokedAt: string | null;
  /** 之後依照的交件數（目前身分看得到的） */
  followed: number;
}

/** 文件 id → 守則的來歷與狀態；不是守則的文件、或目前身分看不到守則或文件時是 null */
export async function readGuidelineOrigin(db: Database, identity: string | null, documentId: string, language: LanguageCode): Promise<GuidelineOrigin | null> {
  if (identity === null) return null;
  const row = await db.withIdentity(identity, async (tx) =>
    (await tx.query<{ guidelineId: string; employeeId: string; employeeName: string; returnedAt: Date | string; reason: ReturnReason; followed: number }>(
      `SELECT gdoc.guideline_id AS "guidelineId", g.employee_id AS "employeeId", e.display_name AS "employeeName",
              rv.decided_at AS "returnedAt", rv.reason,
              (SELECT count(*)::int FROM crew.work_guidelines wg WHERE wg.guideline_id = g.id) AS followed
       FROM crew.guideline_documents gdoc
       JOIN crew.guidelines g ON g.id = gdoc.guideline_id
       JOIN crew.employees e ON e.id = g.employee_id
       JOIN crew.reviews rv ON rv.id = g.source_review_id
       WHERE gdoc.document_id = $1`,
      [documentId],
    )).rows[0],
  );
  if (row === undefined) return null;
  const [guideline] = (await listGuidelines(db, identity, { employeeId: row.employeeId })).filter((g) => g.id === row.guidelineId);
  const confirm = guideline?.decisions.find((d) => d.decision === "confirm");
  if (guideline === undefined || confirm === undefined) return null;
  const texts = guidelineTexts(guideline, language);
  return {
    guidelineId: guideline.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    workTypeId: guideline.workTypeId,
    text: texts.revised ?? texts.proposed,
    proposerKind: guideline.proposerKind,
    assignmentId: guideline.sourceAssignmentId,
    returnedAt: new Date(row.returnedAt).toISOString(),
    reason: row.reason,
    confirmedBy: confirm.decidedBy,
    confirmedAt: confirm.decidedAt,
    revised: confirm.revisedText !== null,
    revokedAt: guideline.decisions.find((d) => d.decision === "revoke")?.decidedAt ?? null,
    followed: row.followed,
  };
}
