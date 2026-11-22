// 知識庫條目的回流（#92 的計畫第 1 節與 `## 決定`）：驗收通過的交件全文 → 一份 knowledge-kit 文件與它的段落。
// 純函式：不讀資料庫、不產生介面文字、不呼叫模型（條目的欄位已是結構化內容）。寫入在 db/store.ts 的 createReview()。
import { parseWorkBody, type WorkSection } from "../work/body";

export interface FlowbackDocument {
  /** 條目名稱（`kb/<條目>` 的名稱；沒有名稱時是 `<條目>`） */
  title: string;
  /** 依出現順序：條目本身的說明（有寫時），以及每個非空白的欄位 */
  passages: string[];
}

/** 回流文件的 id：`crew-<工作 id>`（crew migration 0005 的 policy 檢查同一個格式） */
export const flowbackDocumentId = (workId: string): string => `crew-${workId}`;

const ENTRY_PREFIX = "kb/";

const isEntry = (s: WorkSection) => s.key !== null && s.key.startsWith(ENTRY_PREFIX) && !s.key.includes("#");

// 欄位寫成「名稱、換行、內容」：分隔不用任何語言的標點，名稱與內容都留在段落裡讓問答檢索
const passageOf = (s: WorkSection): string => (s.label ? `${s.label}\n${s.text}` : s.text);

/**
 * 交件全文轉成回流的文件。不是「恰好一個知識庫條目」的結構化全文時回傳 null（不回流）：
 * 舊格式（一行摘要）、格式有錯、沒有或有兩個以上的條目、有不屬於該條目的區塊、沒有任何非空白的內容。
 * 空白欄位（含空白的必填欄位）不寫；重點標記已由 parseWorkBody() 去掉。
 */
export function toFlowbackDocument(body: string): FlowbackDocument | null {
  // 重點數不限：這裡只要文字，不檢查重點編號
  const parsed = parseWorkBody(body, Infinity);
  if (!parsed.structured || parsed.errors.length > 0) return null;
  const entries = parsed.sections.filter(isEntry);
  if (entries.length !== 1) return null;
  const [entry] = entries;
  const fieldPrefix = `${entry.key}#`;
  if (parsed.sections.some((s) => s !== entry && !s.key!.startsWith(fieldPrefix))) return null;

  const passages = parsed.sections
    .filter((s) => s.text.trim() !== "")
    .map((s) => (s === entry ? s.text : passageOf(s)));
  if (passages.length === 0) return null;
  return { title: entry.label ?? entry.key!.slice(ENTRY_PREFIX.length), passages };
}
