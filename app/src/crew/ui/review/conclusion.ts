// 驗收面板 v3 的文案規則（#72 計畫第 2、4、5 點；設計規格 v3 第 6.2、7 節）：交件的種類、結論列、決定列的問句、
// 重點在內容中的位置。純函式：文字一律取自 client/i18n/crew/review.<語言>.json 與 glossary 的翻譯檔。
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { WorkCheck } from "../../trust/types";
import type { ParsedBody } from "../../work/body";
import { crewStrings } from "../../i18n";
import { checkLabel, checkSentence, isCodePosition, positionLabel } from "../glossary";
import { canMark } from "./marked";

/** 交件的種類：回信、貼文、知識庫條目、程式修改；其他工作類型是 null（用一般的寫法） */
export type Deliverable = "reply" | "post" | "kb" | "code";

const BY_WORK_TYPE: Readonly<Record<string, Deliverable>> = { support: "reply", content: "post", knowledge: "kb", dev: "code" };

export const deliverableOf = (workTypeId: string): Deliverable | null => (Object.hasOwn(BY_WORK_TYPE, workTypeId) ? BY_WORK_TYPE[workTypeId] : null);

const SUFFIX = { reply: "Reply", post: "Post", kb: "Kb", code: "Code" } as const satisfies Record<Deliverable, string>;
const suffix = (d: Deliverable | null) => (d === null ? "Other" : SUFFIX[d]);

/** 交件的稱呼（「回信草稿」等） */
export const deliverableName = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`deliverable${suffix(d)}` as const];

/** 結論列的動詞（寄出、貼出、加進知識庫、通過） */
export const deliverableVerb = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`verb${suffix(d)}` as const];

/** 決定列的問句 */
export const decisionQuestion = (d: Deliverable | null, language: LanguageCode) => crewStrings("review", language)[`decision${suffix(d)}` as const];

/**
 * 結論列的對象：`decide` 是能驗收、還沒驗收；`view` 是不能驗收的身分看還沒驗收的工作；
 * `decided` 是已驗收的工作（不顯示結論列，畫面改顯示驗收結果）。
 */
export type Audience = "decide" | "view" | "decided";

export interface Conclusion {
  tone: "fail" | "pending";
  title: string;
  /** 說明；其中的 `{employee}` 留給畫面以 withEmployee() 代入（員工名字前要加 AI 標記） */
  description: string;
}

export interface ConclusionContext {
  deliverable: Deliverable | null;
  body: ParsedBody;
  /** 重點數（`focus.points.length`） */
  pointCount: number;
  audience: Audience;
  language: LanguageCode;
}

/** 空白的必填欄位（`[required]` 且內容是空的）的名稱；沒有名稱時用鍵的白話 */
export function emptyRequiredFields(body: ParsedBody, language: LanguageCode): string[] {
  if (!body.structured) return [];
  return body.sections.filter((s) => s.key !== null && s.attrs.required && s.text === "").map((s) => s.label ?? positionLabel(s.key!, language));
}

/**
 * 結論列：有未通過的檢查時是 `fail`，沒有未通過但有檢查中時是 `pending`；全部通過、沒有檢查或已驗收時是 null。
 * `checks` 是每個檢查最新的一筆（reviewFocus() 的結果）。
 */
export function conclusionOf(checks: readonly WorkCheck[], ctx: ConclusionContext): Conclusion | null {
  if (ctx.audience === "decided") return null;
  const t = crewStrings("review", ctx.language);
  const names = (status: WorkCheck["status"]) =>
    checks
      .filter((c) => c.status === status)
      .map((c) => checkLabel(c.name, ctx.language))
      .join(t.listSeparator);
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length > 0) {
    const values = { verb: deliverableVerb(ctx.deliverable, ctx.language), checks: names("fail") };
    const title = fill(ctx.audience === "decide" ? t.conclusionFail : t.conclusionFailView, values);
    const empty = failed.some((c) => c.name === "required-fields") ? emptyRequiredFields(ctx.body, ctx.language) : [];
    const first =
      empty.length > 0
        ? fill(t.conclusionEmptyFields, { fields: empty.map((field) => fill(t.fieldQuote, { field })).join(t.listSeparator) })
        : checkSentence(failed[0].name, "fail", ctx.language);
    const second = pointsSentence(ctx);
    return { tone: "fail", title, description: first === null ? second : fill(t.conclusionSentences, { first, second }) };
  }
  if (checks.some((c) => c.status === "pending")) {
    return { tone: "pending", title: fill(t.conclusionPending, { checks: names("pending") }), description: t.conclusionPendingNote };
  }
  return null;
}

/** 結論列說明的第二句：重點標在哪裡 */
function pointsSentence({ deliverable, body, pointCount, language }: ConclusionContext): string {
  const t = crewStrings("review", language);
  if (pointCount === 0) return t.conclusionNoPoints;
  const marked = canMark(body) && body.points.length === pointCount && body.points.every((p) => p.length > 0);
  const template = marked ? t.conclusionPointsMarked : t.conclusionPointsListed;
  return fill(template, { count: pointCount, deliverable: deliverableName(deliverable, language) }, language);
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
