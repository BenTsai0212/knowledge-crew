// 「員工」畫面的資料整理（#37；#83 改為員工卡，設計規格 v3 第 6.5 節）：看得到的員工與每類工作的目前層級、
// 驗收次數、待驗收件數、平常的工作來源、最近的圓點與一句說明（看重點的建議或最近的層級事件）。
// 由 readTrust() 的結果依員工分組；沒有看得到的組合的員工也列出（workTypes 為空）。
// 完全沒有看得到的組合時（guest：RLS 讓它看得到員工，但看不到交辦）回傳空的，畫面顯示空狀態。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { listAssignments, type AssignmentSummary, type SourceKind } from "../db/store";
import type { Dot, ReviewLevel } from "../trust/types";
import { assignStatus, usualOf } from "./assign";
import { sourceLabel } from "./refs";
import { readTrust, type CrewEmployee, type TimelineEvent, type Trust } from "./trust";

/** 卡片的一句說明：有看重點的建議（只給能驗收的身分），或時間軸上最近的層級事件。 */
export type EmployeeNote = { kind: "suggestion" } | { kind: "event"; event: TimelineEvent };

export interface EmployeeWorkType {
  workTypeId: string;
  level: ReviewLevel;
  reviewCount: number;
  /** 最近幾次的圓點（舊到新，與信任頁相同） */
  dots: Dot[];
  /** 待驗收件數：最新一輪已交件、還沒驗收的交辦 */
  awaiting: number;
  /** 平常的工作來源（該員工 × 工作類型的交辦中最常用的，名稱是目前語言）；沒有時是 null */
  source: { label: string; kind: SourceKind } | null;
  note: EmployeeNote | null;
}

export type EmployeeSummary = CrewEmployee & { workTypes: EmployeeWorkType[] };

type AssignmentFields = Pick<AssignmentSummary, "employeeId" | "workTypeId" | "sourceId" | "sourceKind" | "sourceName" | "latestRound" | "latestVerdict">;

export function groupEmployees(
  trust: Pick<Trust, "employees" | "rows">,
  assignments: readonly AssignmentFields[],
  language: LanguageCode,
): EmployeeSummary[] {
  if (trust.rows.length === 0) return [];
  return trust.employees.map((e) => ({
    ...e,
    workTypes: trust.rows
      .filter((r) => r.employee.id === e.id)
      .map(({ workTypeId, level, reviewCount, dots, suggestion, timeline }): EmployeeWorkType => {
        const own = assignments.filter((a) => a.employeeId === e.id && a.workTypeId === workTypeId);
        const usual = own.find((a) => a.sourceId === usualOf(own, e.id).sourceId);
        const event = timeline.events.at(-1)?.items.at(-1);
        return {
          workTypeId,
          level,
          reviewCount,
          dots,
          awaiting: own.filter((a) => assignStatus(a) === "awaitingReview").length,
          source: usual ? { label: sourceLabel(usual.sourceId, usual.sourceName, language), kind: usual.sourceKind } : null,
          note: suggestion ? { kind: "suggestion" } : event ? { kind: "event", event } : null,
        };
      }),
  }));
}

export async function readEmployees(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  canReview = false,
): Promise<EmployeeSummary[]> {
  // 看重點的建議只給能驗收的身分（與信任頁一致）
  const trust = await readTrust(db, identity, language, canReview);
  if (identity === null || trust.rows.length === 0) return [];
  return groupEmployees(trust, await listAssignments(db, identity), language);
}
