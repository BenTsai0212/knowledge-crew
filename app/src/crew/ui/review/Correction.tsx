// 事後更正（#164，crew ADR 0008 第 1～6、15 點）：已通過的工作事後發現有錯時記下更正。
// 能驗收的身分、這一輪是通過、還沒有更正時，在「已通過」下方放按鈕，按下後在同一位置展開表單；
// 已有更正時任何看得到的身分都只顯示「通過後發現有錯（日期）」與備註。寫入由 ReviewView 的 correct() 進行。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { createCorrection } from "../../db/store";
import type { CrewTexts } from "../../i18n";
import { shortDate } from "../../time";

type Texts = CrewTexts<"review">;
export type Correct = (input: Parameters<typeof createCorrection>[2]) => Promise<void>;

/** 已記下的更正：日期與備註（沒寫備註時不顯示那一行） */
export function CorrectionDone({ correctedAt, note, language, t }: { correctedAt: string; note: string | null; language: LanguageCode; t: Texts }) {
  return (
    <div className="crew-review__correction" data-state="done">
      <p className="crew-review__correction-title">{fill(t.correctionDone, { date: shortDate(correctedAt, language) })}</p>
      {note !== null && note.trim() !== "" && <p>{fill(t.correctionNoteShown, { note })}</p>}
    </div>
  );
}

interface FormProps {
  reviewId: string;
  /** 「記成 ○○ 的「工作類型」守則」 */
  guidelineLabel: ReactNode;
  /** 送出前的提醒：看重點時會改回逐項看，逐項看時只算一次做錯了 */
  consequence: string;
  saving: boolean;
  correct: Correct;
  t: Texts;
}

/** 「通過後發現有錯」按鈕與展開的表單；焦點比照退回表單（#154）：打開時移到輸入框，取消時回到按鈕，初次顯示時不移動。 */
export function CorrectionForm({ reviewId, guidelineLabel, consequence, saving, correct, t }: FormProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notInPoints, setNotInPoints] = useState(false);
  const [asGuideline, setAsGuideline] = useState(false);
  const [guidelineError, setGuidelineError] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const toggle = (next: boolean) => {
    toggled.current = true;
    setOpen(next);
  };
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (open ? input.current : button.current)?.focus();
  }, [open]);
  const trimmed = note.trim();
  // 記成守則時「發現的問題」必填（比照退回表單）：是空的時按送出才顯示錯誤，不用停用的按鈕
  const submit = () => {
    if (asGuideline && trimmed === "") {
      setGuidelineError(true);
      input.current?.focus();
      return;
    }
    void correct({
      reviewId,
      ...(trimmed === "" ? {} : { note: trimmed }),
      ...(notInPoints ? { notInPoints: true } : {}),
      ...(asGuideline ? { saveAsGuideline: true } : {}),
    });
  };
  if (!open) {
    return (
      <p className="crew-review__correction-open">
        <button ref={button} type="button" className="secondary" disabled={saving} onClick={() => toggle(true)}>
          {t.correctionOpen}
        </button>
      </p>
    );
  }
  return (
    <fieldset className="crew-review__correction" data-state="form" disabled={saving}>
      <legend className="crew-review__correction-title">{t.correctionOpen}</legend>
      <label className="crew-review__note-field">
        {t.correctionNote}
        <textarea
          ref={input}
          value={note}
          aria-required={asGuideline || undefined}
          aria-invalid={guidelineError || undefined}
          aria-describedby={guidelineError ? "crew-review-correction-error" : undefined}
          onChange={(e) => {
            setNote(e.target.value);
            setGuidelineError(false);
          }}
        />
      </label>
      <label className="crew-review__guideline-check">
        <input type="checkbox" checked={notInPoints} onChange={(e) => setNotInPoints(e.target.checked)} />
        <span>{t.correctionNotInPoints}</span>
      </label>
      <div className="crew-review__guideline">
        <label className="crew-review__guideline-check">
          <input
            type="checkbox"
            checked={asGuideline}
            aria-describedby="crew-review-correction-guideline-hint"
            onChange={(e) => {
              setAsGuideline(e.target.checked);
              setGuidelineError(false);
            }}
          />
          <span>{guidelineLabel}</span>
        </label>
        <p id="crew-review-correction-guideline-hint" className="muted crew-review__guideline-hint">
          {t.saveAsGuidelineHint}
        </p>
        {guidelineError && (
          <p id="crew-review-correction-error" className="error" role="alert">
            {t.guidelineNeedsNote}
          </p>
        )}
      </div>
      <p className="crew-review__correction-consequence" role="note">
        {consequence}
      </p>
      <div className="crew-review__buttons">
        <button type="button" className="secondary" onClick={() => toggle(false)}>
          {t.cancel}
        </button>
        <button type="button" className="crew-review__confirm" onClick={submit}>
          {saving ? t.saving : t.correctionSubmit}
        </button>
      </div>
    </fieldset>
  );
}
