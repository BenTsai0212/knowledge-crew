// crew 頁子導覽的數字（#103，設計規格 v3 第 5 節；目前子頁的捲動在共用的 Tabs，#179）。只是資料整理與位置計算，不另寫查詢：
// 數字來自 readToday()（與首頁、側欄的待驗收件數同一份，home-today.ts）。
import type { HomeToday } from "./home-today";
import type { CrewSection } from "./sections";

/** 「員工」是等確認的守則數（#145），「工作與驗收」是待驗收件數，「信任」是待決定的看重點的建議數；只給能驗收的身分，0 不顯示 */
export function sectionCounts(today: HomeToday): Partial<Record<CrewSection, number>> {
  if (!today.canReview) return {};
  const counts: Partial<Record<CrewSection, number>> = {};
  const works = today.failing.length + today.awaiting.length;
  if (works > 0) counts.works = works;
  if (today.decide.length > 0) counts.trust = today.decide.length;
  if (today.guidelines.length > 0) counts.employees = today.guidelines.length;
  return counts;
}
