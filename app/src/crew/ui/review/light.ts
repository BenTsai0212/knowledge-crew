// 驗收面板的看重點（#102；設計規格 v3 第 6.3 節）：「為什麼是看重點」的依據與收起的規則。
// 純函式：不讀資料庫、不產生介面文字。層級仍只由 trust/rules.ts 的 reviewLevel() 決定，這裡不另寫規則。
import type { WorkSection } from "../../work/body";
import type { LevelDecision, Review } from "../../trust/types";

/** 「為什麼是看重點」說明卡的資料 */
export interface LightReason {
  /** 最新一次同意改看重點（`relax`）的時間 */
  relaxedAt: string;
  /** 最近連續沒有做錯的驗收次數，最多 window 次 */
  recent: number;
}

const byTime = <T extends { decidedAt: string }>(xs: readonly T[]) => [...xs].sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));

/** 依既有的驗收紀錄與層級決定（getTrustInputs() 的結果）整理說明卡的日期與次數；沒有同意改看重點的紀錄時是 null。 */
export function lightReason(reviews: readonly Review[], decisions: readonly LevelDecision[], window: number): LightReason | null {
  const relax = byTime(decisions).filter((d) => d.decision === "relax").at(-1);
  if (!relax) return null;
  let recent = 0;
  for (const r of byTime(reviews).reverse()) {
    if (recent >= window || (r.verdict === "returned" && r.reason === "wrong")) break;
    recent += 1;
  }
  return { relaxedAt: relax.decidedAt, recent };
}

/** 區塊有標重點：整個區塊是重點，或內容中有重點的標記 */
export const hasPoint = (s: WorkSection): boolean => s.attrs.points.length > 0 || s.marks.length > 0;

/**
 * 看重點時照樣顯示的欄位：有標重點的欄位與空白的欄位（必填的空白欄位是檢查的對象，選填的空白也一併顯示）。
 * 其他欄位收起。
 */
export const keptInLight = (s: WorkSection): boolean => hasPoint(s) || s.text === "";

/** 把欄位分成照樣顯示與收起兩組，各自依原本的順序；不是看重點時全部照樣顯示 */
export function splitFields(fields: readonly WorkSection[], light: boolean): { shown: WorkSection[]; collapsed: WorkSection[] } {
  if (!light) return { shown: [...fields], collapsed: [] };
  return { shown: fields.filter(keptInLight), collapsed: fields.filter((s) => !keptInLight(s)) };
}
