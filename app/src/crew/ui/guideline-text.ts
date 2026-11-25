// 守則的文字（#145）：資料庫只存預設語言，demo 的守則以 demoText() 換成目前語言，找不到時用資料庫的原文。
// 員工卡（employees.ts）與工作帳本（ledger.ts）共用。
import type { LanguageCode } from "../../client/types";
import type { StoredGuideline, StoredGuidelineDecision } from "../db/store";
import { demoText } from "../demo/texts";

/** 提出時的文字 */
export const proposedText = (g: Pick<StoredGuideline, "id" | "text">, language: LanguageCode): string => demoText("guideline", g.id, language) ?? g.text;

/** 一筆決定修改後的文字（沒有修改時是 null） */
export const revisionText = (d: Pick<StoredGuidelineDecision, "id" | "revisedText">, language: LanguageCode): string | null =>
  d.revisedText === null ? null : (demoText("guidelineRevision", d.id, language) ?? d.revisedText);

/** 提出的文字與確認時修改的文字（沒有修改時是 null）；目前的文字是 `revised ?? proposed` */
export function guidelineTexts(g: Pick<StoredGuideline, "id" | "text" | "decisions">, language: LanguageCode): { proposed: string; revised: string | null } {
  const confirm = g.decisions.find((d) => d.decision === "confirm" && d.revisedText !== null);
  return { proposed: proposedText(g, language), revised: confirm ? revisionText(confirm, language) : null };
}
