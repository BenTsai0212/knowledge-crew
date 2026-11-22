// 回流文件的來源（#92 的計畫第 2 節與 `## 決定` 1）：知識庫的文件來自哪位 AI 員工、哪一次驗收。
// 一律經 db.withIdentity()：回流紀錄看得到（驗收與文件都看得到，crew 0005 的 policy）時才有，否則是 null。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { demoText } from "../demo/texts";

export interface FlowbackOrigin {
  /** 「工作與驗收」要選的交辦 */
  assignmentId: string;
  /** 交辦的標題（目前語言） */
  title: string;
  employeeName: string;
  /** 驗收時間（ISO） */
  decidedAt: string;
}

interface OriginRow {
  assignmentId: string;
  title: string;
  employeeName: string;
  decidedAt: Date | string;
}

const ORIGIN_SQL = `SELECT a.id AS "assignmentId", a.title, e.display_name AS "employeeName", rv.decided_at AS "decidedAt"
  FROM crew.knowledge_flowbacks f
  JOIN crew.reviews rv ON rv.id = f.review_id
  JOIN crew.works w ON w.id = rv.work_id
  JOIN crew.assignments a ON a.id = w.assignment_id
  JOIN crew.employees e ON e.id = a.employee_id`;

/** 文件 id → 來源；不是回流的文件、或目前身分看不到時是 null */
export async function readFlowbackOrigin(db: Database, identity: string | null, documentId: string, language: LanguageCode): Promise<FlowbackOrigin | null> {
  if (identity === null) return null;
  const row = await db.withIdentity(identity, async (tx) => (await tx.query<OriginRow>(`${ORIGIN_SQL} WHERE f.document_id = $1`, [documentId])).rows[0]);
  if (row === undefined) return null;
  return {
    assignmentId: row.assignmentId,
    title: demoText("title", row.assignmentId, language) ?? row.title,
    employeeName: row.employeeName,
    decidedAt: new Date(row.decidedAt).toISOString(),
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
