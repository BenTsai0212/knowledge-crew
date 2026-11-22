// crew 頁的子導覽（#34）：六個位置的順序與名稱的鍵（client/i18n/crew/common.<語言>.json）。
// 畫面元件在 CrewPage.tsx 的 SCREENS 登錄；還沒登錄的位置顯示「準備中」。
import type { ComponentType } from "react";
import type { Database } from "../../db/database";
import type { LanguageCode } from "../../client/types";
import type { CrewScreenKeys } from "../i18n";

export const CREW_SECTIONS = [
  { id: "today", label: "sectionToday" },
  { id: "employees", label: "sectionEmployees" },
  { id: "assignments", label: "sectionAssignments" },
  { id: "works", label: "sectionWorks" },
  { id: "trust", label: "sectionTrust" },
  { id: "ledger", label: "sectionLedger" },
] as const satisfies ReadonlyArray<{ id: string; label: CrewScreenKeys["common"] }>;

export type CrewSection = (typeof CREW_SECTIONS)[number]["id"];

/** 切到另一個位置（#83）；employeeId 是交辦頁預選的員工，assignmentId 是「工作與驗收」預選的交辦（首頁的今天的工作，#96）。 */
export interface CrewTarget {
  section: CrewSection;
  employeeId?: string;
  assignmentId?: string;
}

/** 每個畫面元件收到的 props；identity 與 App.tsx 的身分相同（目前一定有值）。 */
export interface CrewScreenProps {
  db: Database;
  identity: string;
  language: LanguageCode;
  /** 切到另一個位置（CrewPage 提供；單獨使用畫面時沒有） */
  navigate?: (target: CrewTarget) => void;
  /** 交辦頁預選的員工（#83：員工卡的「交辦給 ○○」） */
  employeeId?: string;
  /** 「工作與驗收」預選的交辦（#96） */
  assignmentId?: string;
  /** 寫入後通知 App 重新讀取首頁與側欄的待驗收件數（#96；單獨使用畫面時沒有） */
  onChanged?: () => void;
}

export type CrewScreen = ComponentType<CrewScreenProps>;
