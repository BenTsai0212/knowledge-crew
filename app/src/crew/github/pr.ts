// PR 描述 → 交件（#112；#108 的 `## 決定` 第 5 點、`## 計畫` 第 5 點）。純函式：不連線、不讀資料庫、不產生介面文字。
// - parseManualTodos()：PR 描述的「## 人工待辦」區塊 → 員工標出的「要看的重點」（RFC 0001 必要功能）。
//   讀不到（找不到區塊、格式不符）時不猜，回傳 ok: false；這和「沒有重點」（ok: true、points 是空的）分開。
// - prToWork()：PR 描述與變更的檔案 → 交件全文（docs/crew/work-body-format.md 的程式修改：檔案區塊＋`pr/description`）、
//   重點與變更。格式見 work-body-format.md「PR 描述轉成的交件」。
import type { WorkChange } from "../trust/types";
import type { GitHubPrFile } from "./types";

// PR 範本（.github/pull_request_template.md）的標題與小標。這是格式的分隔字，不是介面文字；
// 介面文字與語言模組的結構測試不允許程式碼中有中日韓文字或 CJK 範圍的 \u 跳脫，所以以碼位產生（同 work/body.ts）。
// 測試（pr.test.ts）比對這些字與 PR 範本相同。
const cp = (...points: number[]) => String.fromCodePoint(...points);
/** 人工待辦 */
export const TODO_HEADING = cp(0x4eba, 0x5de5, 0x5f85, 0x8fa6);
/** 合併前 */
export const BEFORE_MERGE = cp(0x5408, 0x4f75, 0x524d);
/** 合併後 */
export const AFTER_MERGE = cp(0x5408, 0x4f75, 0x5f8c);
/** 無 */
const NONE = cp(0x7121);
/** 全形冒號 */
const COLON = cp(0xff1a);
/** 全形句號 */
const WIDE_PERIOD = cp(0x3002);
// 交件全文的重點標記括號（work/body.ts）與避開格式用的零寬空白
const MARK_OPEN = cp(0x3014);
const MARK_CLOSE = cp(0x3015);
const ZWSP = cp(0x200b);

/** 交件全文中 PR 描述的鍵（work-body-format.md） */
export const PR_DESCRIPTION_KEY = "pr/description";

export type MergePhase = "before" | "after";

/** 人工待辦的一個核取方塊＝一個重點 */
export interface ManualTodo {
  /** 重點的文字；在「合併前：」「合併後：」小標下時，小標寫在前面（「合併前：<文字>」） */
  text: string;
  phase: MergePhase | null;
  /** 核取方塊已勾選 */
  checked: boolean;
  /** PR 描述的第幾行（從 1 開始） */
  line: number;
}

export type ManualTodoError =
  | "missing-section" // 找不到「## 人工待辦」
  | "duplicate-section" // 「## 人工待辦」出現兩次以上
  | "invalid-line"; // 區塊內有核取方塊、小標、「無」以外的內容

/**
 * `ok: true` 時 `points` 依順序是第 1、2…個重點；空的表示「沒有重點」（寫「無」或空白）。
 * `ok: false` 是「讀不到人工待辦」：沒有重點不等於沒有要看的事，呼叫端要請人到 GitHub 看 PR 描述。
 */
export type ManualTodos = { ok: true; points: ManualTodo[] } | { ok: false; error: ManualTodoError; line?: number };

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const CHECKBOX = /^[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const CONTINUATION = /^[ \t]{2,}\S/;
const SUBHEADING = new RegExp(`^(${BEFORE_MERGE}|${AFTER_MERGE})[${COLON}:][ \\t]*(.*)$`);
const NONE_LINE = new RegExp(`^(?:[-*+][ \\t]+)?${NONE}[${WIDE_PERIOD}.]?$`);
const HEADER_LINE = /^@@(?=\s|$)/;
const MARK = new RegExp(`${MARK_OPEN}(?=\\/?\\d+${MARK_CLOSE})`, "g");

/** 換行統一成 \n，HTML 註解（PR 範本的說明）換成空白但保留行數，讓行號對得上原文 */
function prepare(description: string): string[] {
  return description
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ""))
    .split("\n");
}

interface Heading {
  index: number;
  level: number;
  title: string;
}

/** 程式碼區塊以外的 Markdown 標題 */
function headingsOf(lines: readonly string[]): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = HEADING.exec(line);
      if (m) out.push({ index, level: m[1].length, title: (m[2] ?? "").trim() });
    }
  });
  return out;
}

type Located = { ok: true; start: number; end: number } | { ok: false; error: ManualTodoError; line?: number };

/** 「## 人工待辦」的範圍：`start` 是標題行，`end` 是下一個一、二級標題（或結尾），不含 */
function locate(lines: readonly string[]): Located {
  const headings = headingsOf(lines);
  const found = headings.filter((h) => h.level === 2 && h.title === TODO_HEADING);
  if (found.length === 0) return { ok: false, error: "missing-section" };
  if (found.length > 1) return { ok: false, error: "duplicate-section", line: found[1].index + 1 };
  const start = found[0].index;
  const end = headings.find((h) => h.index > start && h.level <= 2)?.index ?? lines.length;
  return { ok: true, start, end };
}

function parseSection(lines: readonly string[], start: number, end: number): ManualTodos {
  const points: ManualTodo[] = [];
  // 每個小標（沒有小標時是 null）下有沒有「無」與核取方塊；兩者並存是格式不符
  const groups = new Map<MergePhase | null, { noneLine: number | null; items: boolean }>();
  const group = (phase: MergePhase | null) => {
    let g = groups.get(phase);
    if (!g) groups.set(phase, (g = { noneLine: null, items: false }));
    return g;
  };
  const invalid = (line: number): ManualTodos => ({ ok: false, error: "invalid-line", line });
  let phase: MergePhase | null = null;
  let last: ManualTodo | null = null;

  for (let i = start + 1; i < end; i++) {
    const raw = lines[i];
    const text = raw.trim();
    const line = i + 1;
    if (text === "") {
      last = null;
      continue;
    }
    if (FENCE.test(raw)) return invalid(line);
    const box = CHECKBOX.exec(text);
    // 核取方塊下縮排的下一行：接在同一個重點後面
    if (last && !box && CONTINUATION.test(raw)) {
      last.text += ` ${text}`;
      continue;
    }
    last = null;
    const sub = SUBHEADING.exec(text);
    if (sub) {
      phase = sub[1] === BEFORE_MERGE ? "before" : "after";
      group(phase);
      const rest = sub[2].trim();
      if (rest === "") continue;
      if (!NONE_LINE.test(rest)) return invalid(line);
      group(phase).noneLine ??= line;
      continue;
    }
    if (NONE_LINE.test(text)) {
      group(phase).noneLine ??= line;
      continue;
    }
    if (box) {
      const body = (box[2] ?? "").trim();
      // 範本留下的空核取方塊（`- [ ]`）不是重點
      if (body === "") continue;
      const label = phase === "before" ? BEFORE_MERGE : phase === "after" ? AFTER_MERGE : null;
      last = { text: label === null ? body : `${label}${COLON}${body}`, phase, checked: box[1] !== " ", line };
      points.push(last);
      group(phase).items = true;
      continue;
    }
    return invalid(line);
  }
  for (const g of groups.values()) if (g.items && g.noneLine !== null) return invalid(g.noneLine);
  return { ok: true, points };
}

/** 解析 PR 描述的「## 人工待辦」（格式見 .github/pull_request_template.md） */
export function parseManualTodos(description: string): ManualTodos {
  const lines = prepare(description);
  const at = locate(lines);
  return at.ok ? parseSection(lines, at.start, at.end) : at;
}

/** PR 轉成的交件 */
export interface PrWork {
  /** 交件全文：每個檔案一個區塊（依輸入順序），最後是 `pr/description` */
  body: string;
  /** 要看的重點（`work_points`，依順序）；讀不到人工待辦時是空的，要看 `manualTodos.ok` */
  points: string[];
  manualTodos: ManualTodos;
  /** 交件的變更（`work_changes`）：每個寫進全文的檔案一筆，說明是增減的行數 */
  changes: WorkChange[];
  /** 路徑不能當區塊的鍵（含空白、與 `pr/description` 相同）而沒有寫進全文的檔案 */
  omittedFiles: string[];
}

/** PR 描述的一行不能被讀成交件全文的格式：`@@` 開頭的行與 〔N〕 的寫法前面加零寬空白 */
const escapeLine = (line: string) => (HEADER_LINE.test(line) ? ZWSP + line : line).replace(MARK, MARK_OPEN + ZWSP);

/** PR 描述（去掉讀得到的人工待辦）→ `pr/description` 區塊的內容 */
function descriptionText(lines: string[], todo: { start: number; end: number } | null): string {
  const kept = todo ? [...lines.slice(0, todo.start), ...lines.slice(todo.end)] : lines;
  return kept
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n")
    .map(escapeLine)
    .join("\n");
}

const changeOf = (file: GitHubPrFile): "added" | "modified" | null =>
  file.status === "added" ? "added" : file.status === "removed" ? null : "modified";

const lineSummary = (file: GitHubPrFile): string =>
  typeof file.additions === "number" && typeof file.deletions === "number" ? `+${file.additions} -${file.deletions}` : "";

/**
 * PR 描述與變更的檔案 → 交件全文、重點與變更。
 * 讀得到人工待辦時，人工待辦成為重點並從 `pr/description` 去掉；讀不到時原文留在 `pr/description`，重點是空的。
 */
export function prToWork(description: string, files: readonly GitHubPrFile[]): PrWork {
  const lines = prepare(description);
  const todo = locate(lines);
  const manualTodos: ManualTodos = todo.ok ? parseSection(lines, todo.start, todo.end) : todo;
  const sections: string[] = [];
  const changes: WorkChange[] = [];
  const omittedFiles: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = file.filename;
    if (seen.has(path)) continue;
    seen.add(path);
    if (path === "" || /\s/.test(path) || path === PR_DESCRIPTION_KEY) {
      omittedFiles.push(path);
      continue;
    }
    const change = changeOf(file);
    sections.push(`@@ ${path}${change === null ? "" : ` [${change}]`}`);
    changes.push({ path, summary: lineSummary(file) });
  }
  sections.push(`@@ ${PR_DESCRIPTION_KEY}`, descriptionText(lines, manualTodos.ok && todo.ok ? todo : null));
  return {
    body: sections.join("\n"),
    points: manualTodos.ok ? manualTodos.points.map((p) => p.text) : [],
    manualTodos,
    changes,
    omittedFiles,
  };
}
