// 驗收面板的文案規則（#72 計畫第 2、4、5 點；#195 改為設計規格 v5 的少字版）：交件的種類、結論、決定列的問句、
// 重點在內容中的位置。純函式：文字一律取自 client/i18n/crew/review.<語言>.json 與 glossary 的翻譯檔。
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { WorkCheck } from "../../trust/types";
import type { ParsedBody } from "../../work/body";
import { crewStrings } from "../../i18n";
import { checkLabel, checkShort, isCodePosition, positionLabel } from "../glossary";
import { canMark } from "./marked";

/** 交件的種類：回信、貼文、知識庫條目、程式修改；其他工作類型是 null（用一般的寫法） */
export type Deliverable = "reply" | "post" | "kb" | "code";

const BY_WORK_TYPE: Readonly<Record<string, Deliverable>> = { support: "reply", content: "post", knowledge: "kb", dev: "code" };

export const deliverableOf = (workTypeId: string): Deliverable | null => (Object.hasOwn(BY_WORK_TYPE, workTypeId) ? BY_WORK_TYPE[workTypeId] : null);

const SUFFIX = { reply: "Reply", post: "Post", kb: "Kb", code: "Code" } as const satisfies Record<Deliverable, string>;
const suffix = (d: Deliverable | null) => (d === null ? "Other" : SUFFIX[d]);

/** 交件的稱呼（「回信草稿」等） */
export const deliverableName = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`deliverable${suffix(d)}` as const];

/** 結論的動作（寄出、發布、加進知識庫、合併） */
export const deliverableVerb = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`verb${suffix(d)}` as const];

/** 決定列的問句 */
export const decisionQuestion = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`decision${suffix(d)}` as const];

/**
 * 結論的對象：`decide` 是能驗收、還沒驗收；`view` 是不能驗收的身分看還沒驗收的工作；
 * `decided` 是已驗收的工作（不顯示結論，畫面改顯示驗收結果）。
 */
export type Audience = "decide" | "view" | "decided";

/** 結論（#195，設計規格 v5 的 big-verdict）：一句話；`fail` 有檢查未通過、`pending` 有檢查中、`pass` 都通過 */
export interface Verdict {
  tone: "fail" | "pending" | "pass";
  text: string;
}

/** 空白的必填欄位（`[required]` 且內容是空的）的名稱；沒有名稱時用鍵的白話 */
export function emptyRequiredFields(body: ParsedBody, language: LanguageCode): string[] {
  if (!body.structured) return [];
  return body.sections.filter((s) => s.key !== null && s.attrs.required && s.text === "").map((s) => s.label ?? positionLabel(s.key!, language));
}

/** 未通過的原因：第一個未通過檢查的簡短說明；必填欄位是空的時寫出欄位名稱；沒有簡短說明時是「{檢查名稱}未通過」 */
function failReason(check: WorkCheck, body: ParsedBody, language: LanguageCode): string {
  const t = crewStrings("review", language);
  const empty = check.name === "required-fields" ? emptyRequiredFields(body, language) : [];
  if (empty.length > 0) return fill(t.conclusionEmptyFields, { fields: empty.map((field) => fill(t.fieldQuote, { field })).join(t.listSeparator) });
  return checkShort(check.name, language) ?? fill(t.verdictCheckFailed, { check: checkLabel(check.name, language) });
}

/**
 * 結論：有未通過的檢查時「先別{動作}：{原因}」（不能驗收的身分不寫動作），沒有未通過但有檢查中時「還在檢查：…」，
 * 都通過時「系統檢查都通過」；沒有檢查或已驗收時是 null。`checks` 是每個檢查最新的一筆（reviewFocus() 的結果）。
 */
export function verdictOf(checks: readonly WorkCheck[], ctx: { deliverable: Deliverable | null; body: ParsedBody; audience: Audience; language: LanguageCode }): Verdict | null {
  if (ctx.audience === "decided" || checks.length === 0) return null;
  const t = crewStrings("review", ctx.language);
  const failed = checks.find((c) => c.status === "fail");
  if (failed) {
    const reason = failReason(failed, ctx.body, ctx.language);
    const text = ctx.audience === "decide" ? fill(t.verdictFail, { verb: deliverableVerb(ctx.deliverable, ctx.language), reason }) : fill(t.verdictFailView, { reason });
    return { tone: "fail", text };
  }
  const pending = checks.filter((c) => c.status === "pending");
  if (pending.length > 0) {
    return { tone: "pending", text: fill(t.conclusionPending, { checks: pending.map((c) => checkLabel(c.name, ctx.language)).join(t.listSeparator) }) };
  }
  return { tone: "pass", text: t.verdictPass };
}

/** 重點在內容中的一個位置；`code` 為 true 時畫面以等寬字顯示 */
export interface PointPlace {
  text: string;
  code: boolean;
}

/**
 * 每個重點在內容中的位置（重點卡每一列下方的小字）：同一個區塊只列一次，依出現順序。
 * 回信與貼文是段落名稱，條目欄位是「『名稱』欄位」，程式是檔案路徑或「PR 描述」。不能標出重點時每個都是空的。
 */
export function pointPlaces(body: ParsedBody, language: LanguageCode): PointPlace[][] {
  if (!canMark(body)) return body.points.map(() => []);
  const t = crewStrings("review", language);
  const labels = new Map(body.sections.map((s) => [s.key, s.label]));
  const place = (key: string): PointPlace => {
    const label = labels.get(key) ?? null;
    if (key.startsWith("pr/")) return { text: key === "pr/description" ? t.prDescription : key, code: key !== "pr/description" };
    if (key.startsWith("kb/") && label !== null) {
      return { text: key.includes("#") ? fill(t.positionKbField, { field: label }) : fill(t.fieldQuote, { field: label }), code: false };
    }
    return { text: positionLabel(key, language), code: isCodePosition(key) };
  };
  return body.points.map((locations) => [...new Set(locations.map((l) => l.key))].map(place));
}
