// 首頁的「今天的工作」（#96，RFC 0001 的 2026-11-22 修訂「首頁」，設計規格 v3 第 6.1 節）：把 readToday() 的結果分組、寫成總結與每列的狀態。
// 只是資料整理，不另寫查詢；可見範圍由 readToday() 的 RLS 決定。文字在 client/i18n/crew/home.<語言>.json。
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import { crewStrings } from "../i18n";
import type { CheckStatus } from "../trust/types";
import { checkLabel } from "./glossary";
import type { CrewTarget } from "./sections";
import type { Today, TodayAssignment, TodaySuggestion } from "./today";

export interface HomeToday {
  canReview: boolean;
  /** 1. 先處理・有檢查沒通過：待驗收中最新一輪有未通過的檢查 */
  failing: TodayAssignment[];
  /** 2. 待驗收：其餘待驗收 */
  awaiting: TodayAssignment[];
  /** 3. 等你決定：少看建議（只有能驗收的身分） */
  decide: TodaySuggestion[];
  /** 4. 進行中 */
  inProgress: TodayAssignment[];
}

export const hasFailedCheck = (a: TodayAssignment) => a.checks.some((c) => c.status === "fail");

export function homeToday(today: Today): HomeToday {
  return {
    canReview: today.canReview,
    failing: today.awaitingReview.filter(hasFailedCheck),
    awaiting: today.awaitingReview.filter((a) => !hasFailedCheck(a)),
    decide: today.canReview ? today.suggestions : [],
    inProgress: today.inProgress,
  };
}

/** 四組都是空的：能驗收的身分顯示一句空狀態，其他身分整區不顯示 */
export const isHomeTodayEmpty = (h: HomeToday) => h.failing.length + h.awaiting.length + h.decide.length + h.inProgress.length === 0;

/** 側欄「AI 員工」的待驗收件數（與「待審」分開）：只給能驗收的身分，其他身分是 null（不顯示） */
export const awaitingCount = (today: Today): number | null => (today.canReview ? today.awaitingReview.length : null);

/** 問候下方的一句總結；沒有待驗收、少看建議與進行中時是 null */
export function homeSummary(h: HomeToday, language: LanguageCode): string | null {
  const t = crewStrings("home", language);
  const awaiting = h.failing.length + h.awaiting.length;
  const parts: string[] = [];
  if (awaiting > 0) {
    const template = h.canReview
      ? h.failing.length > 0 ? t.summaryAwaitingFailing : t.summaryAwaiting
      : h.failing.length > 0 ? t.summaryAwaitingFailingOthers : t.summaryAwaitingOthers;
    parts.push(fill(template, { count: awaiting, failing: h.failing.length }, language));
  }
  if (h.decide.length > 0) parts.push(fill(t.summaryDecide, { count: h.decide.length }, language));
  // 進行中只在沒有其他事時提一句（不是要你處理的事）
  if (parts.length === 0 && h.inProgress.length > 0) parts.push(fill(t.summaryInProgress, { count: h.inProgress.length }, language));
  return parts.length === 0 ? null : `${parts.join(t.summarySeparator)}${t.summaryEnd}`;
}

const STATUS_KEY = { pass: "statusCheckPass", fail: "statusCheckFail", pending: "statusCheckPending" } as const satisfies Record<CheckStatus, string>;

/** 每列的狀態一句：有檢查沒通過只列未通過的檢查；待驗收列出每個檢查；進行中是還沒交件或退回後等下一輪 */
export function rowStatus(a: TodayAssignment, awaiting: boolean, language: LanguageCode): string {
  const t = crewStrings("home", language);
  if (!awaiting) return a.returned ? t.statusReturned : t.statusNotSubmitted;
  const checks = hasFailedCheck(a) ? a.checks.filter((c) => c.status === "fail") : a.checks;
  if (checks.length === 0) return t.statusNoChecks;
  return checks.map((c) => fill(t[STATUS_KEY[c.status]], { check: checkLabel(c.name, language) }, language)).join(t.statusSeparator);
}

/** 點了到哪裡：待驗收與退回的到「工作與驗收」該件，還沒交件的到「交辦」，少看建議到「信任」 */
export const rowTarget = (a: TodayAssignment, awaiting: boolean): CrewTarget =>
  awaiting || a.returned ? { section: "works", assignmentId: a.id } : { section: "assignments" };
export const DECIDE_TARGET: CrewTarget = { section: "trust" };
