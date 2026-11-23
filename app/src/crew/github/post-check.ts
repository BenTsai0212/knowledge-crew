// 平台寫進 GitHub 之前的檢查（#111；#108 第 4 點、D3）。純函式：不讀檔、不讀環境變數、不連線。
// email、個人路徑與禁用名稱的規則與 tools/workflow/check-sensitive.mjs（check-post-body.mjs 匯入同一套）一致；
// 兩邊以同一組測試案例確認結果相同（tools/workflow/testdata/post-check-cases.json）。
// 不通過時只回報欄位、行號與種類，不回傳命中的文字。
import type { IssueDraft, PostCheckResult, PostFinding, PostFindingKind } from "./types";

// 放行的網域：RFC 2606 保留的網域，比對本身與子網域
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
// 放行的頂級網域：RFC 2606／6761 保留，加上文件說明格式時常用的 .tld
const RESERVED_TLDS = ["test", "example", "invalid", "localhost", "tld"];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** /Users/<名稱>、/home/<名稱>；/home/runner 與角括號佔位不算。 */
const PERSONAL_PATH = /\/(?:Users\/|home\/(?!runner(?![\w.-])))[\w.-]+/;

const underDomain = (domain: string, base: string) => domain === base || domain.endsWith(`.${base}`);

/** 放行的 email：noreply@…、git@<主機>、*.noreply.github.com、example 網域與保留頂級網域。 */
export function isAllowedEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  if (local === "noreply" || local === "git") return true;
  if (underDomain(domain, "noreply.github.com")) return true;
  if (RESERVED_DOMAINS.some((base) => underDomain(domain, base))) return true;
  return RESERVED_TLDS.includes(domain.slice(domain.lastIndexOf(".") + 1));
}

/** 一行中的 email；頂級網域不是英文字母的不算（例如套件版本 pkg@1.2.3）。 */
export function findEmails(line: string): string[] {
  return [...line.matchAll(EMAIL)]
    .map((m) => m[0])
    .filter((address) => /^[A-Za-z]{2,}$/.test(address.slice(address.lastIndexOf(".") + 1)));
}

/**
 * 逐行檢查（含程式碼區塊與行內程式碼：貼出後一樣公開）。names 是禁用名稱，不分大小寫、以子字串比對。
 * 回傳的順序與 check-sensitive.mjs 的 scanText() 相同：同一行依 email、個人路徑、禁用名稱。
 */
export function scanLines(text: string, names: readonly string[]): { line: number; kind: PostFindingKind }[] {
  const lowered = names.map((n) => n.toLowerCase());
  const findings: { line: number; kind: PostFindingKind }[] = [];
  text.split(/\r?\n/).forEach((content, i) => {
    const line = i + 1;
    if (findEmails(content).some((address) => !isAllowedEmail(address))) findings.push({ line, kind: "email" });
    if (PERSONAL_PATH.test(content)) findings.push({ line, kind: "personalPath" });
    const lower = content.toLowerCase();
    if (lowered.some((n) => lower.includes(n))) findings.push({ line, kind: "deniedName" });
  });
  return findings;
}

/**
 * 禁用名稱清單是否可用：呼叫的一方必須傳入至少一個名稱。
 * 沒有傳入（例如讀不到 secret）與空清單看起來一樣是設定遺漏，都拒絕，不當成「沒有禁用名稱」。
 */
function usableNames(names: readonly string[] | null | undefined): string[] | null {
  if (!Array.isArray(names)) return null;
  const list = names.map((n) => (typeof n === "string" ? n.trim() : "")).filter((n) => n.length > 0);
  return list.length > 0 ? list : null;
}

// agent 視為人的決定或修正要求的控制標題（tools/workflow/headings.mjs 的 decision、changeRequest，兩種流程語言）。
// 結構測試不允許程式碼中有中日韓文字，所以中文標題以碼位產生；測試確認與 headings.mjs 一致。
const zh = (...codes: number[]) => String.fromCodePoint(...codes);
export const BLOCKED_COMMENT_HEADINGS: readonly string[] = [
  `## ${zh(0x6c7a, 0x5b9a)}`,
  "## Decision",
  `## ${zh(0x4fee, 0x6b63, 0x8981, 0x6c42)}`,
  "## Change request",
];

/**
 * 文字（去掉開頭空白）是否以 h 開頭；與 headings.mjs 的 startsWithHeading() 相同，
 * 但英文標題不分大小寫（平台不寫這些標題，寧可多擋）。
 */
function startsWithHeading(text: string, h: string): boolean {
  const s = text.trimStart();
  if (!/[A-Za-z]$/.test(h)) return s.startsWith(h);
  if (s.slice(0, h.length).toLowerCase() !== h.toLowerCase()) return false;
  return !/^[A-Za-z0-9-]/.test(s.slice(h.length));
}

/** 留言是否以 `## 決定`、`## 修正要求`（或英文）開頭（#108 D3：PAT 寫出的留言身分是 OWNER，必須在程式擋）。 */
export const startsWithControlHeading = (body: string): boolean =>
  BLOCKED_COMMENT_HEADINGS.some((h) => startsWithHeading(body, h));

const result = (findings: PostFinding[]): PostCheckResult => ({ ok: findings.length === 0, findings });
const missingNames = (): PostCheckResult => result([{ field: "body", line: 0, kind: "deniedNamesMissing" }]);

const inField = (field: PostFinding["field"], text: string, names: readonly string[]): PostFinding[] =>
  scanLines(text, names).map((f) => ({ field, ...f }));

/** 一般留言的檢查：email、個人路徑、禁用名稱，以及不得以控制標題開頭。 */
export function checkComment(body: string, deniedNames: readonly string[] | null | undefined): PostCheckResult {
  const names = usableNames(deniedNames);
  if (!names) return missingNames();
  const findings = inField("body", body, names);
  if (startsWithControlHeading(body)) {
    const line = body.slice(0, body.length - body.trimStart().length).split(/\r?\n/).length;
    findings.unshift({ field: "body", line, kind: "controlHeading" });
  }
  return result(findings);
}

/** 建立 Issue 前的檢查：標題與本文的 email、個人路徑、禁用名稱。 */
export function checkIssue(draft: Pick<IssueDraft, "title" | "body">, deniedNames: readonly string[] | null | undefined): PostCheckResult {
  const names = usableNames(deniedNames);
  if (!names) return missingNames();
  return result([...inField("title", draft.title, names), ...inField("body", draft.body, names)]);
}
