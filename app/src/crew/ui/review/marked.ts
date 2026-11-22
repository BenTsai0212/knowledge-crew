// 驗收面板 v3 的重點標記（#72 計畫第 4 點）：把區塊的內容依 `marks` 切成片段，畫面把有編號的片段畫成底線＋上標。
// 純函式：不讀資料庫、不產生介面文字。標記的位置來自 work/body.ts 的 parseWorkBody()。
import type { ParsedBody, SectionMark } from "../../work/body";

export interface TextSegment {
  text: string;
  /** 標記的重點編號；不是重點的片段是 null */
  point: number | null;
}

/**
 * 依 `marks` 把文字切成片段，依原文順序；空字串的片段不列入。
 * 超出文字範圍、或與前一個標記重疊的標記略過（parseWorkBody() 不會產生這種標記）。
 */
export function segments(text: string, marks: readonly SectionMark[]): TextSegment[] {
  const out: TextSegment[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < at || m.end > text.length || m.end <= m.start) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start), point: null });
    out.push({ text: text.slice(m.start, m.end), point: m.point });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), point: null });
  return out;
}

/** 能依結構呈現、在內容中標出重點：有標頭行且沒有解析錯誤。否則畫面退回純文字，重點只列在重點卡。 */
export const canMark = (body: ParsedBody): boolean => body.structured && body.errors.length === 0;

/** 第 i 個重點（從 0 開始）在內容中有位置、可以點選 */
export const pointLocated = (body: ParsedBody, index: number): boolean => canMark(body) && (body.points[index]?.length ?? 0) > 0;
