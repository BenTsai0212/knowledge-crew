// 「交辦」畫面的資料整理（#38 計畫第 2、3 節）：交辦清單、表單的選項、交辦與模擬交件的寫入。
// 一律經 db.withIdentity()，可見範圍與寫入權限由 RLS 決定。資料庫的文字以 demoText() 換成目前語言，找不到時用原文。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import {
  createAssignment,
  listAssignments,
  listEmployees,
  listSources,
  type AssignmentSummary,
  type NewAssignment,
  type StoredEmployee,
  type StoredSource,
} from "../db/store";
import { DEMO } from "../demo/load";
import { pickReply, simulateSubmission } from "../demo/simulate";
import { demoText } from "../demo/texts";
import type { DemoFile } from "../demo/types";
import type { TodayEmployee } from "./today";

/** 還沒交件／待驗收／退回後等下一輪／已通過 */
export type AssignStatus = "notSubmitted" | "awaitingReview" | "returned" | "accepted";

/** available：可以模擬交件；noReply：該員工 × 工作類型沒有預先回覆；none：不顯示按鈕 */
export type SimulateState = "available" | "noReply" | "none";

export interface AssignItem {
  id: string;
  title: string;
  sourceName: string;
  externalRef: string | null;
  workTypeId: string;
  employee: TodayEmployee;
  status: AssignStatus;
  latestRound: number | null;
  simulate: SimulateState;
}

export interface AssignData {
  canReview: boolean;
  sources: StoredSource[];
  employees: TodayEmployee[];
  workTypes: string[];
  /** 新到舊 */
  assignments: AssignItem[];
}

/** 與 today.ts 的待驗收、進行中一致。 */
export function assignStatus(a: Pick<AssignmentSummary, "latestRound" | "latestVerdict">): AssignStatus {
  if (a.latestRound === null) return "notSubmitted";
  if (a.latestVerdict === null) return "awaitingReview";
  return a.latestVerdict === "returned" ? "returned" : "accepted";
}

export function simulateState(
  canReview: boolean,
  a: Pick<AssignmentSummary, "employeeId" | "workTypeId" | "latestRound" | "latestVerdict">,
  demo: DemoFile | null,
): SimulateState {
  const status = assignStatus(a);
  if (!canReview || (status !== "notSubmitted" && status !== "returned")) return "none";
  if (!demo) return "noReply";
  return pickReply(demo, a.employeeId, a.workTypeId, (a.latestRound ?? 0) + 1) ? "available" : "noReply";
}

/** 工作類型的 id（store.ts 沒有這個讀取）；員工與工作類型有身分就看得到。 */
export function listWorkTypes(db: Database, identity: string | null): Promise<string[]> {
  return db.withIdentity(identity, async (tx) =>
    (await tx.query<{ id: string }>("SELECT id FROM crew.work_types ORDER BY id")).rows.map((r) => r.id),
  );
}

const EMPTY = (canReview: boolean): AssignData => ({ canReview, sources: [], employees: [], workTypes: [], assignments: [] });

export async function readAssign(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  canReview: boolean,
  demo: DemoFile | null = DEMO,
): Promise<AssignData> {
  // 沒有身分時比照 readToday：不讀取
  if (identity === null) return EMPTY(false);
  const [sources, stored, workTypes, assignments] = await Promise.all([
    listSources(db, identity),
    listEmployees(db, identity),
    listWorkTypes(db, identity),
    listAssignments(db, identity),
  ]);
  const employees = stored.map((e) => toEmployee(e, language));
  const byId = new Map(employees.map((e) => [e.id, e]));
  return {
    canReview,
    sources,
    employees,
    workTypes,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: demoText("title", a.id, language) ?? a.title,
      sourceName: a.sourceName,
      externalRef: a.externalRef,
      workTypeId: a.workTypeId,
      employee: byId.get(a.employeeId) ?? { id: a.employeeId, displayName: a.employeeId, roleNote: null },
      status: assignStatus(a),
      latestRound: a.latestRound,
      simulate: simulateState(canReview, a, demo),
    })),
  };
}

/** 交辦；標題去掉前後空白，空白時拋錯且不寫入。外部編號由 createAssignment() 決定。 */
export function submitAssignment(
  db: Database,
  identity: string | null,
  input: NewAssignment,
): Promise<{ id: string; externalRef: string | null }> {
  const title = input.title.trim();
  if (title === "") return Promise.reject(new Error("submitAssignment: title is required"));
  return createAssignment(db, identity, { ...input, title });
}

/** 模擬交件：寫入下一輪，文字用目前語言。 */
export function simulateAssignment(
  db: Database,
  identity: string | null,
  assignmentId: string,
  demo: DemoFile,
  language: LanguageCode,
): Promise<{ workId: string; round: number }> {
  return simulateSubmission(db, identity, assignmentId, demo, language);
}

// today.ts 的 toEmployee 沒有匯出（不修改 today.ts）
function toEmployee(e: StoredEmployee, language: LanguageCode): TodayEmployee {
  return { id: e.id, displayName: e.displayName, roleNote: demoText("roleNote", e.id, language) ?? e.roleNote };
}
