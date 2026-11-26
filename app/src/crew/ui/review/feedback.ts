// 驗收面板的逐條回饋（#168，crew ADR 0008 第 12～14 點）：驗收時對重點標「沒問題／有問題」、對依照的守則標「做到／沒做到」。
// 純函式：選取的狀態、送出時的 createReview() 的 `feedback`、字串的鍵。標記只和驗收一起寫入，不影響信任。
import type { GuidelineResult, NewFeedback, PointResult, StoredFeedback } from "../../db/store";
import type { CrewTexts } from "../../i18n";

type Texts = CrewTexts<"review">;

/** 選中的標記：重點以序號（從 1 開始）、守則以 id 為鍵 */
export interface Marks {
  points: ReadonlyMap<number, PointResult>;
  guidelines: ReadonlyMap<string, GuidelineResult>;
}

export const NO_MARKS: Marks = { points: new Map(), guidelines: new Map() };

export const POINT_RESULTS = ["ok", "problem"] as const satisfies readonly PointResult[];
export const GUIDELINE_RESULTS = ["done", "not_done"] as const satisfies readonly GuidelineResult[];

export const RESULT_TEXT = {
  ok: "feedbackPointOk",
  problem: "feedbackPointProblem",
  done: "feedbackGuidelineDone",
  not_done: "feedbackGuidelineNotDone",
} as const satisfies Record<PointResult | GuidelineResult, keyof Texts>;

/** 同一對象最多選一個；再選一次已選的結果時取消 */
export function toggled<K, R>(marks: ReadonlyMap<K, R>, key: K, result: R): Map<K, R> {
  const next = new Map(marks);
  if (next.get(key) === result) next.delete(key);
  else next.set(key, result);
  return next;
}

/** 送出時的 `feedback`：沒有任何標記時是 undefined（不傳） */
export function feedbackInput(marks: Marks): NewFeedback | undefined {
  if (marks.points.size === 0 && marks.guidelines.size === 0) return undefined;
  return {
    ...(marks.points.size > 0 ? { points: [...marks.points].sort(([a], [b]) => a - b).map(([ordinal, result]) => ({ ordinal, result })) } : {}),
    ...(marks.guidelines.size > 0 ? { guidelines: [...marks.guidelines].map(([guidelineId, result]) => ({ guidelineId, result })) } : {}),
  };
}

/** 已驗收的逐條回饋（getReviewDetails()）換成 Marks，給唯讀的標籤用 */
export const storedMarks = (feedback: StoredFeedback): Marks => ({
  points: new Map(feedback.points.map((p) => [p.ordinal, p.result])),
  guidelines: new Map(feedback.guidelines.map((g) => [g.guidelineId, g.result])),
});

/** 切換按鈕組的可存取名稱 `feedbackFor` 的 `{item}`：重點或守則文字的前 20 字 */
export const feedbackItem = (text: string): string => [...text.trim()].slice(0, 20).join("");
