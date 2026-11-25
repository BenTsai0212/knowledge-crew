// 驗收面板的「這次依照的守則」（#147，crew ADR 0007 決定 5）：員工自述這次交件依照了哪些守則。
// 純函式：輸入是 listWorkGuidelines() 的結果與交件時間，不讀資料庫。文字是交件當時的文字（當時以前的確認修改過就用修改後的）。
import type { LanguageCode } from "../../../client/types";
import type { StoredGuideline } from "../../db/store";
import type { ProposerKind } from "../../guidelines/status";
import { proposedText, revisionText } from "../guideline-text";

export interface FollowedGuideline {
  id: string;
  /** 交件當時的文字（目前語言） */
  text: string;
  /** 人提（退回時記下）或員工提（人確認） */
  proposerKind: ProposerKind;
  /** 來歷的日期（ISO）：人提是提出時間（退回時記下），員工提是交件以前最近一次確認的時間 */
  since: string;
  /** 交件之後被收回 */
  retiredLater: boolean;
}

const time = (iso: string) => Date.parse(iso);

/** 依提出時間排列（listWorkGuidelines() 的順序）；交件以前沒有確認的守則仍列出，日期退回提出時間。 */
export function followedGuidelines(guidelines: readonly StoredGuideline[], submittedAt: string, language: LanguageCode): FollowedGuideline[] {
  const at = time(submittedAt);
  return guidelines.map((g) => {
    const before = g.decisions.filter((d) => time(d.decidedAt) <= at);
    const confirm = before.filter((d) => d.decision === "confirm").at(-1);
    const revised = confirm ? revisionText(confirm, language) : null;
    return {
      id: g.id,
      text: revised ?? proposedText(g, language),
      proposerKind: g.proposerKind,
      since: g.proposerKind === "human" || !confirm ? g.proposedAt : confirm.decidedAt,
      retiredLater: g.decisions.some((d) => d.decision === "revoke" && time(d.decidedAt) > at),
    };
  });
}

/** 同一員工 × 工作類型等確認的守則數；不能驗收的身分一律是 0（不提示） */
export const pendingGuidelineCount = (guidelines: readonly Pick<StoredGuideline, "status">[], canReview: boolean): number =>
  canReview ? guidelines.filter((g) => g.status === "pending").length : 0;
