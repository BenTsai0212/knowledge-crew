// 交件全文的結構與「要看的重點」標記（#65 的 `## 決定`；格式見 docs/crew/work-body-format.md）。
// 全文仍是一段文字（works.body 不改型別）：以 `@@ <鍵> [屬性 …] | <名稱>` 標頭行分區塊，
// 重點以行內 〔N〕…〔/N〕 或標頭屬性 [point N]（整個區塊）標出。純函式：不讀資料庫、不產生介面文字。

/** 程式修改的檔案：新增或修改 */
export type FileChange = "added" | "modified";

export interface SectionAttrs {
  /** 必填欄位（知識庫條目） */
  required: boolean;
  /** 程式修改的檔案 */
  change: FileChange | null;
  /** 整個區塊是這些重點（`[point N]`），由小到大 */
  points: number[];
}

/** 行內重點：`start`、`end` 是去掉標記後 `text` 的位置（UTF-16，end 不含） */
export interface SectionMark {
  point: number;
  start: number;
  end: number;
}

export interface WorkSection {
  /** 區塊的鍵（與 `changes[].path` 相同）；舊格式是 null */
  key: string | null;
  /** 內容本身的名稱（知識庫的條目與欄位名稱）；沒有時是 null */
  label: string | null;
  attrs: SectionAttrs;
  /** 去掉標記後的內容（前後空行已去掉；空白欄位是空字串） */
  text: string;
  marks: SectionMark[];
}

/** 重點的一個位置：沒有 `range` 表示整個區塊 */
export interface PointLocation {
  key: string;
  range?: { start: number; end: number };
}

export type BodyErrorCode =
  | "text-before-header" // 第一個標頭行之前有內容
  | "invalid-header" // 標頭行的寫法不對
  | "duplicate-key" // 同一個鍵出現兩次
  | "unknown-attr" // 不認得的屬性
  | "conflicting-attr" // [added] 與 [modified] 同時出現
  | "invalid-point" // 重點編號是 0、有前導 0，或超過重點數
  | "unclosed-mark" // 〔N〕 到區塊結尾都沒有關閉（標記不可跨區塊）
  | "unexpected-close" // 〔/N〕 沒有對應的 〔N〕，或編號與開頭不同
  | "overlapping-mark" // 標記重疊或巢狀
  | "empty-mark"; // 〔N〕〔/N〕 之間沒有文字

/** 錯誤只有代碼與位置；給人看的文字由呼叫端決定 */
export interface BodyError {
  code: BodyErrorCode;
  /** 全文的第幾行（從 1 開始） */
  line: number;
  key?: string;
  point?: number;
}

export interface ParsedBody {
  /** 有任何標頭行時是 true；舊格式（一行摘要等）是 false */
  structured: boolean;
  sections: WorkSection[];
  /** `points[i]` 是第 i + 1 個重點的位置（依出現順序）；長度是 `pointCount` */
  points: PointLocation[][];
  errors: BodyError[];
}

const HEADER = /^@@(?:\s|$)/;
const HEADER_PARTS = /^@@ +(\S+)((?: +\[[^\]]*\])*) *(?:\| *(.*))?$/;
const ATTR = /\[([^\]]*)\]/g;
// 重點標記 〔N〕〔/N〕 的括號（U+3014、U+3015）。這是格式的分隔符號，不是語言規則或介面文字；
// 介面文字（client/i18n.test.ts）與語言模組（language/structure.test.ts）的結構測試不允許程式碼中有全形字元
// 或 CJK 範圍的 \u 跳脫，所以以碼位產生。
const MARK_OPEN = String.fromCodePoint(0x3014);
const MARK_CLOSE = String.fromCodePoint(0x3015);
const MARK = new RegExp(`${MARK_OPEN}(\\/?)(\\d+)${MARK_CLOSE}`, "g");

interface Line {
  text: string;
  line: number;
}

const emptyAttrs = (): SectionAttrs => ({ required: false, change: null, points: [] });

/** 重點編號：正整數、沒有前導 0、不超過重點數；不合格時是 null */
function pointNumber(digits: string, pointCount: number): number | null {
  if (!/^[1-9]\d*$/.test(digits)) return null;
  const n = Number(digits);
  return n <= pointCount ? n : null;
}

/**
 * 解析交件全文。`pointCount` 是這件交件的重點數（`points.length`）。
 * 沒有標頭行的舊全文原樣回傳為一個沒有鍵的區塊，不處理 〔N〕。
 * 有錯誤時仍回傳去掉標記的文字，但不合格的標記不列入 `marks`。
 */
export function parseWorkBody(body: string, pointCount: number): ParsedBody {
  const lines = body.split(/\r?\n/);
  const points: PointLocation[][] = Array.from({ length: Number.isFinite(pointCount) ? Math.max(0, pointCount) : 0 }, () => []);

  if (!lines.some((l) => HEADER.test(l))) {
    return { structured: false, sections: [{ key: null, label: null, attrs: emptyAttrs(), text: body, marks: [] }], points, errors: [] };
  }

  const errors: BodyError[] = [];
  const sections: WorkSection[] = [];
  const seen = new Set<string>();
  let current: { key: string; label: string | null; attrs: SectionAttrs; content: Line[] } | null = null;
  // 寫法不對的標頭行之後的內容不另報錯（已有 invalid-header），也不列入區塊
  let dropped = false;

  const finish = () => {
    if (!current) return;
    const section = buildSection(current.key, current.label, current.attrs, current.content, pointCount, errors);
    sections.push(section);
    for (const p of section.attrs.points) (points[p - 1] ??= []).push({ key: section.key! });
    for (const m of section.marks) (points[m.point - 1] ??= []).push({ key: section.key!, range: { start: m.start, end: m.end } });
  };

  lines.forEach((text, i) => {
    const line = i + 1;
    if (!HEADER.test(text)) {
      if (current) current.content.push({ text, line });
      else if (!dropped && text.trim() !== "") errors.push({ code: "text-before-header", line });
      return;
    }
    finish();
    current = null;
    const parts = HEADER_PARTS.exec(text.trimEnd());
    if (!parts) {
      errors.push({ code: "invalid-header", line });
      dropped = true;
      return;
    }
    const key = parts[1];
    if (seen.has(key)) errors.push({ code: "duplicate-key", line, key });
    seen.add(key);
    const label = parts[3]?.trim() || null;
    current = { key, label, attrs: parseAttrs(parts[2], line, key, pointCount, errors), content: [] };
  });
  finish();

  return { structured: true, sections, points, errors };
}

function parseAttrs(raw: string, line: number, key: string, pointCount: number, errors: BodyError[]): SectionAttrs {
  const attrs = emptyAttrs();
  const changes = new Set<FileChange>();
  for (const [, inner] of raw.matchAll(ATTR)) {
    const attr = inner.trim();
    const point = /^point +(\S+)$/.exec(attr);
    if (attr === "required") attrs.required = true;
    else if (attr === "added" || attr === "modified") changes.add(attr);
    else if (point) {
      const n = pointNumber(point[1], pointCount);
      if (n === null) errors.push({ code: "invalid-point", line, key });
      else if (!attrs.points.includes(n)) attrs.points.push(n);
    } else errors.push({ code: "unknown-attr", line, key });
  }
  if (changes.size > 1) errors.push({ code: "conflicting-attr", line, key });
  else attrs.change = [...changes][0] ?? null;
  attrs.points.sort((a, b) => a - b);
  return attrs;
}

function buildSection(key: string, label: string | null, attrs: SectionAttrs, content: Line[], pointCount: number, errors: BodyError[]): WorkSection {
  let from = 0;
  let to = content.length;
  while (from < to && content[from].text.trim() === "") from++;
  while (to > from && content[to - 1].text.trim() === "") to--;

  let text = "";
  const marks: SectionMark[] = [];
  let open: { point: number | null; start: number; line: number } | null = null;
  // 因重疊而不採用的開頭標記：對應的關閉標記略過，不再另報錯
  const ignored: (number | null)[] = [];

  content.slice(from, to).forEach(({ text: raw, line }, i) => {
    if (i > 0) text += "\n";
    let last = 0;
    for (const m of raw.matchAll(MARK)) {
      text += raw.slice(last, m.index);
      last = m.index + m[0].length;
      const n = pointNumber(m[2], pointCount);
      if (n === null) errors.push({ code: "invalid-point", line, key });
      if (m[1] !== "/") {
        if (open) {
          errors.push({ code: "overlapping-mark", line, key, point: n ?? undefined });
          ignored.push(n);
        } else open = { point: n, start: text.length, line };
        continue;
      }
      const skip = ignored.indexOf(n);
      if (skip >= 0 && !(open && open.point === n)) {
        ignored.splice(skip, 1);
      } else if (!open || open.point !== n) {
        errors.push({ code: "unexpected-close", line, key, point: n ?? undefined });
        open = null;
      } else {
        if (n !== null) {
          if (open.start === text.length) errors.push({ code: "empty-mark", line, key, point: n });
          else marks.push({ point: n, start: open.start, end: text.length });
        }
        open = null;
      }
    }
    text += raw.slice(last);
  });
  const unclosed = open as { point: number | null; line: number } | null;
  if (unclosed) errors.push({ code: "unclosed-mark", line: unclosed.line, key, point: unclosed.point ?? undefined });
  return { key, label, attrs, text, marks };
}

/**
 * 給還沒有結構化呈現的畫面用的純文字：區塊之間空一行、去掉標頭與標記（名稱也不顯示）。
 * 舊格式原樣回傳。有錯誤時同樣只去掉認得的標記。
 */
export function toPlainText(body: string): string {
  const parsed = parseWorkBody(body, Infinity);
  if (!parsed.structured) return body;
  return parsed.sections
    .map((s) => s.text)
    .filter((t) => t !== "")
    .join("\n\n");
}
