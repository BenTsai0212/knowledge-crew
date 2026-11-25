// 守則進知識庫（#149 的計畫第 2 節，crew ADR 0007 決定 7）：確認的守則 → 一份 knowledge-kit 文件（兩段：守則的文字、來歷）。
// 純函式：不讀資料庫、不呼叫模型；固定文字在 client/i18n/crew/knowledge.<語言>.json。寫入在 db/store.ts 的 writeGuidelineDocument()。
import { fill } from "../../client/i18n";
import type { AccessFile, LanguageCode } from "../../client/types";
import type { ProposerKind } from "../guidelines/status";
import { crewStrings } from "../i18n";
import type { ReturnReason } from "../trust/types";
import { workTypeLabel } from "../ui/labels";

/** 守則文件的 id：`crew-guideline-<守則 id>`（crew migration 0008 的 CHECK 檢查同一個格式；回流是 `crew-<工作 id>`） */
export const guidelineDocumentId = (guidelineId: string): string => `crew-guideline-${guidelineId}`;

/** 文件 id → 守則 id；不是守則文件時是 null */
export const guidelineIdOfDocument = (documentId: string): string | null =>
  documentId.startsWith("crew-guideline-") ? documentId.slice("crew-guideline-".length) : null;

/** 標題中守則文字的長度上限（超過時截斷並加省略號）；同一員工 × 工作類型可以有多條守則，只寫前半句會重複 */
export const TITLE_TEXT_LENGTH = 24;

export interface GuidelineDocumentInput {
  employeeName: string;
  workTypeId: string;
  /** 守則目前的文字（確認時修改過就是修改後的文字） */
  text: string;
  proposerKind: ProposerKind;
  /** 來源退回的日期與原因 */
  returnDate: string;
  reason: ReturnReason;
  /** 確認者的名稱與確認日期 */
  confirmerName: string;
  confirmDate: string;
  /** 確認時修改過 */
  revised: boolean;
}

export interface GuidelineDocument {
  title: string;
  /** 守則的文字、來歷 */
  passages: [string, string];
}

/** 退回原因的名稱（與驗收畫面相同的文字） */
export function reasonLabel(reason: ReturnReason, language: LanguageCode): string {
  const t = crewStrings("review", language);
  return reason === "wrong" ? t.reasonWrong : reason === "different_approach" ? t.reasonDifferentApproach : t.reasonProcess;
}

/** 身分的名稱（access.json 的 label）；沒有時是 id */
export const identityName = (access: AccessFile, id: string, language: LanguageCode): string =>
  access.roles.find((r) => r.id === id)?.label[language] ?? id;

export function toGuidelineDocument(input: GuidelineDocumentInput, language: LanguageCode): GuidelineDocument {
  const t = crewStrings("knowledge", language);
  const text = input.text.trim();
  const chars = [...text];
  const short = chars.length > TITLE_TEXT_LENGTH ? `${chars.slice(0, TITLE_TEXT_LENGTH).join("").trimEnd()}${t.guidelineDocEllipsis}` : text;
  const names = { employee: input.employeeName, workType: workTypeLabel(input.workTypeId, language) };
  const origin = fill(t.guidelineDocOrigin, {
    ...names,
    returnDate: input.returnDate,
    reason: reasonLabel(input.reason, language),
    drafted: input.proposerKind === "employee" ? fill(t.guidelineDocDrafted, names, language) : "",
    confirmer: input.confirmerName,
    confirmDate: input.confirmDate,
    revised: input.revised ? t.guidelineDocRevised : "",
  }, language);
  return { title: fill(t.guidelineDocTitle, { ...names, text: short }, language), passages: [text, origin] };
}
