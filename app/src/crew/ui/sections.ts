// crew 頁的子導覽（#34）：四個位置的順序與名稱的鍵（client/i18n/crew/common.<語言>.json）。
// #191（ADR 0009 第二節）：六個改為四個。「總覽」成為「工作」的看板、「信任」每類工作的列移到「員工」、
// 「工作帳本」成為「紀錄」（總表在「看統計」）；舊的 id 以 resolveCrewTarget() 對應到新位置。
// 畫面元件在 CrewPage.tsx 的 SCREENS 登錄；還沒登錄的位置顯示「準備中」。
import type { ComponentType } from "react";
import type { Database } from "../../db/database";
import type { LanguageCode } from "../../client/types";
import type { CrewScreenKeys } from "../i18n";
import type { LedgerFilter } from "./ledger";

export const CREW_SECTIONS = [
  { id: "works", label: "sectionWorks" },
  { id: "employees", label: "sectionEmployees" },
  { id: "assignments", label: "sectionAssignments" },
  { id: "records", label: "sectionRecords" },
] as const satisfies ReadonlyArray<{ id: string; label: CrewScreenKeys["common"] }>;

export type CrewSection = (typeof CREW_SECTIONS)[number]["id"];

/** 從導覽點進「AI 員工」（CrewPage 沒有收到 request）時的位置（#100；#191 改為「工作」） */
export const DEFAULT_CREW_SECTION: CrewSection = "works";

/** 「工作」與「紀錄」的顯示方式（#191）：工作的「清單｜看板」、紀錄的「事件｜統計」；沒有時是清單、事件 */
export type CrewView = "board" | "stats";

/** 切到另一個位置（#83）；employeeId 是交辦頁預選的員工（「員工」時捲到該員工），assignmentId 是「工作」選取的交辦（原文的來源 #92、首頁的今天的工作 #96）。 */
export interface CrewTarget {
  section: CrewSection;
  employeeId?: string;
  assignmentId?: string;
  /** 「紀錄」的篩選（#121：統計表點一列或退回的數字） */
  ledgerFilter?: LedgerFilter;
  view?: CrewView;
}

/** #191 之前的 id（書籤、外部連結或舊程式帶的）對應到的新位置 */
const LEGACY: Record<string, Pick<CrewTarget, "section" | "view">> = {
  overview: { section: "works", view: "board" },
  trust: { section: "employees" },
  ledger: { section: "records" },
};

/** 把收到的位置換成目前的四個位置之一：舊的 id 對應到新位置，不認得的 id 回到預設位置 */
export function resolveCrewTarget(target: Omit<CrewTarget, "section"> & { section: string }): CrewTarget {
  const { section, ...rest } = target;
  if (CREW_SECTIONS.some((s) => s.id === section)) return { ...rest, section: section as CrewSection };
  return { ...rest, ...(Object.hasOwn(LEGACY, section) ? LEGACY[section] : { section: DEFAULT_CREW_SECTION }) };
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
  /** 「工作與驗收」選取的交辦（#92：原文的「來自 AI 員工 ○○」；#96：首頁的今天的工作） */
  assignmentId?: string;
  /** 「紀錄」一開始的篩選（#121） */
  ledgerFilter?: LedgerFilter;
  /** 一開始的顯示方式（#191：工作的看板、紀錄的統計） */
  view?: CrewView;
  /** 打開知識庫的原文（#92：回流的「已收進知識庫」；App 提供，沒有時不顯示「打開原文」） */
  onOpenSource?: (passageId: string) => void;
  /** 寫入後通知 App 重新讀取首頁與側欄的待驗收件數（#96；單獨使用畫面時沒有） */
  onChanged?: () => void;
}

export type CrewScreen = ComponentType<CrewScreenProps>;
