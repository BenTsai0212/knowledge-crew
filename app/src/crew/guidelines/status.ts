// 守則的狀態（crew ADR 0007 決定 3）：由人的決定推算，只新增不覆寫。資料庫（crew/0007）以部分唯一索引與寫入 policy
// 守住相同的順序；這裡給存取函式在寫入前判斷（清楚的錯誤）、給畫面與 demo 的驗證推算狀態。
import type { ReturnReason } from "../trust/types";

export type GuidelineDecisionKind = "confirm" | "reject" | "revoke";

export const GUIDELINE_DECISIONS: readonly GuidelineDecisionKind[] = ["confirm", "reject", "revoke"];

/** 提出者：人（退回時記成守則，同時確認）或 AI 員工（等人決定）。 */
export type ProposerKind = "human" | "employee";

/** 等確認、生效、不採用、已收回。 */
export type GuidelineStatus = "pending" | "active" | "rejected" | "revoked";

export interface GuidelineDecision {
  decision: GuidelineDecisionKind;
  /** 確認時修改的文字；其他決定是 null */
  revisedText: string | null;
  decidedAt: string;
}

/** 退回能不能成為守則：原因是「做錯了」或「我想要不一樣的做法」，而且有意見（與 crew.reviews.can_be_guideline 相同）。 */
export function canBeGuideline(reason: ReturnReason | null, note: string | null | undefined): boolean {
  return (reason === "wrong" || reason === "different_approach") && (note ?? "").trim() !== "";
}

// 依時間排序；同時間保持原本的順序（人提的守則，確認與提出同時）
const ordered = (decisions: readonly GuidelineDecision[]) =>
  decisions.map((d, i) => ({ d, i })).sort((x, y) => Date.parse(x.d.decidedAt) - Date.parse(y.d.decidedAt) || x.i - y.i).map((x) => x.d);

const STATUS_AFTER: Record<GuidelineDecisionKind, GuidelineStatus> = { confirm: "active", reject: "rejected", revoke: "revoked" };

/** 最近一筆決定決定狀態；沒有決定時是等確認。 */
export function guidelineStatus(decisions: readonly GuidelineDecision[]): GuidelineStatus {
  const last = ordered(decisions).at(-1);
  return last ? STATUS_AFTER[last.decision] : "pending";
}

/** 目前的文字：確認時修改過就以修改後的文字為準，否則是提出的文字。 */
export function currentText(text: string, decisions: readonly GuidelineDecision[]): string {
  return decisions.find((d) => d.decision === "confirm" && d.revisedText !== null)?.revisedText ?? text;
}

/** 下一筆決定是否允許：等確認 → 確認或不採用；生效 → 收回；不採用與已收回不能再決定。 */
export function canDecide(decisions: readonly GuidelineDecision[], next: GuidelineDecisionKind): boolean {
  const status = guidelineStatus(decisions);
  if (status === "pending") return next === "confirm" || next === "reject";
  return status === "active" && next === "revoke";
}

/** 某個時間點是否生效（交件依照的守則要在交件時生效）：那時以前確認、以前沒有收回。 */
export function activeAt(decisions: readonly GuidelineDecision[], at: string): boolean {
  const t = Date.parse(at);
  const before = decisions.filter((d) => Date.parse(d.decidedAt) <= t);
  return before.some((d) => d.decision === "confirm") && !before.some((d) => d.decision === "revoke");
}
