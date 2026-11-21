// 「員工」畫面的資料整理（#37 計畫第 1 節）：看得到的員工與每類工作的目前層級、驗收次數。
// 由 readTrust() 的結果依員工分組；沒有看得到的組合的員工也列出（workTypes 為空）。
// 完全沒有看得到的組合時（guest：RLS 讓它看得到員工，但看不到交辦）回傳空的，畫面顯示空狀態。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import type { ReviewLevel } from "../trust/types";
import { readTrust, type CrewEmployee, type Trust } from "./trust";

export interface EmployeeWorkType {
  workTypeId: string;
  level: ReviewLevel;
  reviewCount: number;
}

export type EmployeeSummary = CrewEmployee & { workTypes: EmployeeWorkType[] };

export function groupEmployees(trust: Pick<Trust, "employees" | "rows">): EmployeeSummary[] {
  if (trust.rows.length === 0) return [];
  return trust.employees.map((e) => ({
    ...e,
    workTypes: trust.rows
      .filter((r) => r.employee.id === e.id)
      .map(({ workTypeId, level, reviewCount }) => ({ workTypeId, level, reviewCount })),
  }));
}

export async function readEmployees(db: Database, identity: string | null, language: LanguageCode): Promise<EmployeeSummary[]> {
  // 層級與次數不需要建議，以不能驗收的身分整理
  return groupEmployees(await readTrust(db, identity, language, false));
}
