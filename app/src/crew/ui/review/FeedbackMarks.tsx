// 逐條回饋的切換按鈕與唯讀標籤（#168，crew ADR 0008 第 12～14 點）。
// 切換按鈕：一組兩個 aria-pressed 的按鈕，整組的名稱是「對「…」的回饋」；再按一次已選的按鈕取消。
// 唯讀標籤：已驗收的這一輪，有標記的重點與守則旁顯示選了哪一個，沒有按鈕。
import { fill } from "../../../client/i18n";
import type { CrewTexts } from "../../i18n";
import { feedbackItem, RESULT_TEXT } from "./feedback";

type Texts = CrewTexts<"review">;
type Result = keyof typeof RESULT_TEXT;

interface ToggleProps<R extends Result> {
  /** 重點或守則的文字（組名取前 20 字） */
  item: string;
  results: readonly R[];
  selected: R | undefined;
  onSelect: (result: R) => void;
  disabled?: boolean;
  t: Texts;
}

export function FeedbackToggle<R extends Result>({ item, results, selected, onSelect, disabled, t }: ToggleProps<R>) {
  return (
    <div className="crew-review__feedback" role="group" aria-label={fill(t.feedbackFor, { item: feedbackItem(item) })}>
      {results.map((r) => (
        <button key={r} type="button" className="chip" data-result={r} aria-pressed={selected === r} disabled={disabled} onClick={() => onSelect(r)}>
          {t[RESULT_TEXT[r]]}
        </button>
      ))}
    </div>
  );
}

/** 唯讀的標記；沒有標記時不顯示 */
export function FeedbackTag({ result, t }: { result: Result | undefined; t: Texts }) {
  if (result === undefined) return null;
  return (
    <span className="badge crew-review__feedback-tag" data-result={result}>
      {t[RESULT_TEXT[result]]}
    </span>
  );
}
