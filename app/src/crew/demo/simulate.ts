// 「模擬交件」（#29 計畫第 4 節）：以目前身分，從 demo.json 預先寫好的回覆產生下一輪的工作。
// 寫入權限完全交給 RLS：看不到的交辦拋錯，staff、guest 寫入時資料庫拒絕。
import type { LanguageCode, LocalizedText } from "../../client/types";
import type { Database } from "../../db/database";
import { createWork, getAssignmentWorks, listAssignments, nextExternalRef } from "../db/store";
import type { DemoFile, DemoReply } from "./types";

/** 第 n 次交件（從 1 開始）用的回覆；回覆不夠時沿用最後一則。沒有對應的預先回覆時為 null。 */
export function pickReply(demo: DemoFile, employeeId: string, workTypeId: string, round: number): DemoReply | null {
  const replies = demo.simulations.find((s) => s.employee === employeeId && s.workType === workTypeId)?.replies ?? [];
  if (replies.length === 0) return null;
  return replies[Math.min(round, replies.length) - 1];
}

export async function simulateSubmission(
  db: Database,
  identityId: string | null,
  assignmentId: string,
  demo: DemoFile,
  language: LanguageCode,
): Promise<{ workId: string; round: number }> {
  const assignment = (await listAssignments(db, identityId)).find((a) => a.id === assignmentId);
  if (!assignment) throw new Error(`simulateSubmission: assignment not found: ${assignmentId}`);

  const works = await getAssignmentWorks(db, identityId, assignmentId);
  const round = (works.at(-1)?.round ?? 0) + 1;
  const reply = pickReply(demo, assignment.employeeId, assignment.workTypeId, round);
  if (!reply) throw new Error(`simulateSubmission: no prepared reply for ${assignment.employeeId} × ${assignment.workTypeId}`);

  const text = (t: LocalizedText) => t[language];
  const created = await createWork(db, identityId, {
    assignmentId,
    externalRef: await nextExternalRef(db, identityId, assignment.sourceId),
    summary: text(reply.summary),
    body: text(reply.body),
    points: reply.points.map(text),
    changes: reply.changes.map((c) => ({ path: c.path, summary: text(c.summary) })),
    checks: reply.checks.map(({ name, status }) => ({ name, status })),
  });
  return { workId: created.id, round: created.round };
}
