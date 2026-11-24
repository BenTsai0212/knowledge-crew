// crew 頁子導覽的數字與目前子頁的捲動（#103，設計規格 v3 第 5 節）。只是資料整理與位置計算，不另寫查詢：
// 數字來自 readToday()（與首頁、側欄的待驗收件數同一份，home-today.ts）。
import type { HomeToday } from "./home-today";
import type { CrewSection } from "./sections";

/** 「工作與驗收」是待驗收件數，「信任」是待決定的看重點的建議數；只給能驗收的身分，0 不顯示 */
export function sectionCounts(today: HomeToday): Partial<Record<CrewSection, number>> {
  if (!today.canReview) return {};
  const counts: Partial<Record<CrewSection, number>> = {};
  const works = today.failing.length + today.awaiting.length;
  if (works > 0) counts.works = works;
  if (today.decide.length > 0) counts.trust = today.decide.length;
  return counts;
}

interface Span {
  left: number;
  right: number;
}

/** 按鈕列要橫向捲動多少（正數往右），目前的按鈕才整個看得見；已經看得見時是 0。比按鈕列寬時對齊左緣 */
export function scrollDelta(row: Span, button: Span): number {
  if (button.left < row.left || button.right - button.left > row.right - row.left) return button.left - row.left;
  if (button.right > row.right) return button.right - row.right;
  return 0;
}
