// 「交辦」畫面的資料整理（#38 計畫第 2、3 節）：交辦清單、表單的選項、交辦與模擬交件的寫入。
// 一律經 db.withIdentity()，可見範圍與寫入權限由 RLS 決定。資料庫的文字以 demoText() 換成目前語言，找不到時用原文。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import {
  createAssignment,
  getTrustInputs,
  listAssignments,
  listEmployees,
  listSources,
  type AssignmentSummary,
  type NewAssignment,
  type Priority,
  type SourceKind,
  type StoredEmployee,
  type StoredSource,
} from "../db/store";
import { DEMO } from "../demo/load";
import { pickReply, simulateSubmission } from "../demo/simulate";
import { demoText } from "../demo/texts";
import { reviewLevel } from "../trust/rules";
import type { ReviewLevel } from "../trust/types";
import { sourceLabel } from "./refs";
import type { DemoFile } from "../demo/types";
import { deliverableOf } from "./review/conclusion";
import { crewToday, isDateOnly, shownDueStatus, type DueStatus } from "../work/due";
import type { TodayEmployee } from "./today";

/** 還沒交件／待驗收／退回後等下一輪／已通過 */
export type AssignStatus = "notSubmitted" | "awaitingReview" | "returned" | "accepted";

/** available：可以模擬交件；noReply：該員工 × 工作類型沒有預先回覆；none：不顯示按鈕 */
export type SimulateState = "available" | "noReply" | "none";

export interface AssignItem {
  id: string;
  title: string;
  sourceKind: SourceKind;
  sourceName: string;
  externalRef: string | null;
  workTypeId: string;
  employee: TodayEmployee;
  assignedAt: string;
  /** 到期日（YYYY-MM-DD，#133）；沒有時是 null */
  dueAt: string | null;
  priority: Priority;
  /** 畫面標示的到期狀態（shownDueStatus()；已通過的不標逾期） */
  due: DueStatus;
  status: AssignStatus;
  latestRound: number | null;
  simulate: SimulateState;
}

/** 表單的員工（#76）：平常的來源與工作類型從看得到的交辦紀錄推得，層級是該工作類型目前的層級。 */
export type AssignEmployee = TodayEmployee & {
  /** 沒有交辦紀錄，或平常的來源看不到時是 null */
  usualSourceId: string | null;
  /** 沒有交辦紀錄時是 null（表單不能交辦給他） */
  workTypeId: string | null;
  level: ReviewLevel;
};

export interface AssignData {
  canReview: boolean;
  /** `label` 是目前語言的顯示名稱（sourceLabel()） */
  sources: (StoredSource & { label: string })[];
  employees: AssignEmployee[];
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

/** 清單（新到舊）中出現最多次的值；次數相同時取較新的。沒有時是 null。 */
function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
  return best;
}

/** 員工平常的來源與工作類型（#76）：該員工交辦紀錄（新到舊）中最常用的；沒有紀錄時都是 null。 */
export function usualOf(
  assignments: readonly Pick<AssignmentSummary, "employeeId" | "sourceId" | "workTypeId">[],
  employeeId: string,
): { sourceId: string | null; workTypeId: string | null } {
  const own = assignments.filter((a) => a.employeeId === employeeId);
  return { sourceId: mostCommon(own.map((a) => a.sourceId)), workTypeId: mostCommon(own.map((a) => a.workTypeId)) };
}

/**
 * 表單一開始的選擇（#83）：預選的員工看得到、且有工作類型時選他並帶入平常的來源；
 * 否則不選員工，來源是第一個看得到的來源（沒有時是空字串）。
 */
export function initialChoice(
  data: Pick<AssignData, "sources" | "employees">,
  employeeId: string | undefined,
): { employeeId: string; sourceId: string } {
  const first = data.sources[0]?.id ?? "";
  const e = data.employees.find((x) => x.id === employeeId && x.workTypeId !== null);
  if (!e) return { employeeId: "", sourceId: first };
  return { employeeId: e.id, sourceId: e.usualSourceId ?? first };
}

/** 結果說明的文字鍵（assign 翻譯檔的 result*）：交件的稱呼依工作類型。 */
export function resultKey(workTypeId: string): "resultReply" | "resultPost" | "resultKb" | "resultCode" | "resultOther" {
  const d = deliverableOf(workTypeId);
  return d === "reply" ? "resultReply" : d === "post" ? "resultPost" : d === "kb" ? "resultKb" : d === "code" ? "resultCode" : "resultOther";
}

/** 交辦清單預設顯示的件數（設計規格 v3 第 6.6 節：最近 4 件） */
export const RECENT_COUNT = 4;

/** 交辦清單要顯示的件數：預設最近 RECENT_COUNT 件，showAll 時全部。 */
export const visibleAssignments = <T>(items: readonly T[], showAll: boolean): readonly T[] =>
  showAll ? items : items.slice(0, RECENT_COUNT);

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
  /** 到期狀態的「今天」（YYYY-MM-DD）；預設是 demo 的 today，沒有時是目前的日期 */
  today: string = crewToday(demo),
): Promise<AssignData> {
  // 沒有身分時比照 readToday：不讀取
  if (identity === null) return EMPTY(false);
  const [sources, stored, workTypes, assignments] = await Promise.all([
    listSources(db, identity),
    listEmployees(db, identity),
    listWorkTypes(db, identity),
    listAssignments(db, identity),
  ]);
  const visible = new Set(sources.map((s) => s.id));
  const employees: AssignEmployee[] = await Promise.all(
    stored.map(async (e) => {
      const usual = usualOf(assignments, e.id);
      const level = usual.workTypeId === null ? "item" : await levelOf(db, identity, e.id, usual.workTypeId);
      const usualSourceId = usual.sourceId !== null && visible.has(usual.sourceId) ? usual.sourceId : null;
      return { ...toEmployee(e, language), usualSourceId, workTypeId: usual.workTypeId, level };
    }),
  );
  const byId = new Map(employees.map(({ id, displayName, roleNote }) => [id, { id, displayName, roleNote }]));
  return {
    canReview,
    sources: sources.map((s) => ({ ...s, label: sourceLabel(s.id, s.name, language) })),
    employees,
    workTypes,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: demoText("title", a.id, language) ?? a.title,
      sourceKind: a.sourceKind,
      sourceName: sourceLabel(a.sourceId, a.sourceName, language),
      externalRef: a.externalRef,
      workTypeId: a.workTypeId,
      employee: byId.get(a.employeeId) ?? { id: a.employeeId, displayName: a.employeeId, roleNote: null },
      assignedAt: a.assignedAt,
      dueAt: a.dueAt,
      priority: a.priority,
      due: shownDueStatus(a.dueAt, today, assignStatus(a) === "accepted"),
      status: assignStatus(a),
      latestRound: a.latestRound,
      simulate: simulateState(canReview, a, demo),
    })),
  };
}

/** 交辦；標題去掉前後空白，空白時拋錯且不寫入。到期日有值時必須是 YYYY-MM-DD（#133）。外部編號由 createAssignment() 決定。 */
export function submitAssignment(
  db: Database,
  identity: string | null,
  input: NewAssignment,
): Promise<{ id: string; externalRef: string | null }> {
  const title = input.title.trim();
  if (title === "") return Promise.reject(new Error("submitAssignment: title is required"));
  if (input.dueAt != null && !isDateOnly(input.dueAt)) return Promise.reject(new Error("submitAssignment: dueAt must be YYYY-MM-DD"));
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

async function levelOf(db: Database, identity: string, employeeId: string, workTypeId: string): Promise<ReviewLevel> {
  const { reviews, decisions } = await getTrustInputs(db, identity, employeeId, workTypeId);
  return reviewLevel(reviews, decisions);
}

// today.ts 的 toEmployee 沒有匯出（不修改 today.ts）
function toEmployee(e: StoredEmployee, language: LanguageCode): TodayEmployee {
  return { id: e.id, displayName: e.displayName, roleNote: demoText("roleNote", e.id, language) ?? e.roleNote };
}
