// 驗收面板 v3（#72 計畫第 1、5 點；設計規格 v3 第 6.2 節）：標題卡（結論列）→ 重點＋自動檢查 → 交件本身 → 前幾輪 → 決定列。
// 資料只來自 readReviewPanel()；文字在 client/i18n/crew/review.<語言>.json。寫入行為與 v2 相同（createReview() 後重新讀取）。
import { useState, type RefObject } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { createReview } from "../../db/store";
import type { ReturnReason } from "../../trust/types";
import { crewStrings, type CrewTexts } from "../../i18n";
import { CheckRow, ConclusionRow, LevelBadge, withEmployee } from "../components";
import type { ReviewPanel as PanelData, WorkListItem } from "../review";
import { assignmentRef, workRef } from "../refs";
import { BodyView, PointList } from "./BodyView";
import { conclusionOf, decisionQuestion, deliverableName, type Audience } from "./conclusion";

type Texts = CrewTexts<"review">;
export type Decide = (input: Parameters<typeof createReview>[2]) => Promise<void>;

export const REASON_TEXT = {
  wrong: "reasonWrong",
  different_approach: "reasonDifferentApproach",
  process: "reasonProcess",
} as const satisfies Record<ReturnReason, keyof Texts>;
const REASONS = Object.keys(REASON_TEXT) as ReturnReason[];

export function itemRef(item: WorkListItem, t: Texts, language: LanguageCode): string {
  const assignment = assignmentRef(item, language);
  const work = workRef(item.sourceKind, item.workRef, language);
  return work === null ? assignment : fill(t.itemRef, { assignment, work });
}

interface PanelProps {
  anchor: RefObject<HTMLElement | null>;
  panel: PanelData;
  language: LanguageCode;
  saving: boolean;
  saveFailed: boolean;
  decide: Decide;
}

export function ReviewPanel({ anchor, panel, language, saving, saveFailed, decide }: PanelProps) {
  const t = crewStrings("review", language);
  const { item, focus, current, earlier, body, deliverable } = panel;
  const audience: Audience = panel.canDecide ? "decide" : item.verdict !== null ? "decided" : "view";
  const conclusion = conclusionOf(focus.checks, { deliverable, body, pointCount: focus.points.length, audience, language });
  const name = deliverableName(deliverable, language);
  const role = item.employee.roleNote;
  const meta = withEmployee(
    role === null ? t.submittedByNoRole : t.submittedBy,
    { role: role ?? "", deliverable: name, round: current.round, date: formatTime(current.submittedAt, language) },
    item.employee.displayName,
    language,
  );
  return (
    <article ref={anchor} className="crew-review__panel" aria-labelledby="crew-review-title">
      <header className="card crew-review__head">
        <div className="crew-review__head-top">
          <span className="muted crew-review__ref">{itemRef(item, t, language)}</span>
          <LevelBadge level={focus.level}>{fill(t.levelBadge, { level: focus.level === "light" ? t.levelLight : t.levelItem })}</LevelBadge>
        </div>
        <h3 id="crew-review-title">{item.title}</h3>
        <p className="muted">{meta}</p>
        {item.verdict !== null && (
          <p>
            <span className="badge" data-verdict={item.verdict}>
              {item.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
            </span>
          </p>
        )}
        {conclusion && (
          <ConclusionRow
            tone={conclusion.tone}
            title={conclusion.title}
            description={withEmployee(conclusion.description, {}, item.employee.displayName, language)}
          />
        )}
      </header>
      {/* 少看的說明（規格 6.3）由另一張 Issue 放在這裡 */}
      {focus.level === "light" && <div className="crew-review__light-slot" />}

      <div className="crew-review__pair">
        <section className="card crew-review__section">
          <h4>{t.points}</h4>
          <p className="muted crew-review__by">{withEmployee(t.pointsBy, {}, item.employee.displayName, language)}</p>
          {focus.noPoints ? (
            <p className="crew-review__notice" role="note">
              {t.noPoints}
            </p>
          ) : (
            <PointList points={focus.points} body={body} language={language} />
          )}
        </section>
        <section className="card crew-review__section">
          <h4>{t.checks}</h4>
          {focus.checks.length === 0 ? (
            <p className="muted">{t.checksEmpty}</p>
          ) : (
            <ul className="crew-review__checks">
              {focus.checks.map((c) => (
                <li key={c.name}>
                  <CheckRow name={c.name} status={c.status} language={language} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <BodyView name={name} body={body} raw={focus.body.text} changes={focus.changes} language={language} />

      {earlier.length > 0 && (
        <section className="card crew-review__section">
          <h4>{t.earlier}</h4>
          {earlier.map((w) => (
            <details key={w.round} className="crew-review__details">
              <summary>{earlierRound(w.round, workRef(item.sourceKind, w.externalRef, language), t)}</summary>
              <p>{w.summary}</p>
              <p className="muted">{fill(t.submittedAt, { date: formatDate(w.submittedAt, language) })}</p>
              {w.review === null ? (
                <p className="muted">{t.earlierPending}</p>
              ) : (
                <p>
                  <span className="badge" data-verdict={w.review.verdict}>
                    {w.review.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
                  </span>{" "}
                  {w.review.reason && t[REASON_TEXT[w.review.reason]]}
                  {w.review.note && <span className="muted crew-review__note">{w.review.note}</span>}
                </p>
              )}
            </details>
          ))}
        </section>
      )}

      {panel.canDecide ? (
        <DecisionBar question={decisionQuestion(deliverable, language)} workId={current.id} saving={saving} decide={decide} t={t} />
      ) : (
        audience === "view" && <p className="muted crew-review__view-only">{t.viewOnlyNote}</p>
      )}
      {saveFailed && (
        <p className="error" role="alert">
          {t.saveFailed}
        </p>
      )}
    </article>
  );
}

interface DecisionProps {
  question: string;
  workId: string;
  saving: boolean;
  decide: Decide;
  t: Texts;
}

/** 決定列：問句＋退回（次要）＋通過（主要）；按退回後展開三張原因卡，「確定退回」是墨色實心按鈕。 */
function DecisionBar({ question, workId, saving, decide, t }: DecisionProps) {
  // 退回的表單只存在元件 state；換一筆工作時（key 改變）重設
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  return (
    <section className="card crew-review__decision">
      {!returning ? (
        <div className="crew-review__decision-row">
          <p className="crew-review__question">{question}</p>
          <div className="crew-review__buttons">
            <button type="button" className="secondary" disabled={saving} onClick={() => setReturning(true)}>
              {t.return}
            </button>
            <button type="button" disabled={saving} onClick={() => decide({ workId, verdict: "accepted" })}>
              {saving ? t.saving : t.accept}
            </button>
          </div>
        </div>
      ) : (
        <fieldset className="crew-review__return" disabled={saving}>
          <legend>{t.returnReason}</legend>
          <div className="crew-review__reasons">
            {REASONS.map((r) => (
              <label key={r} className="crew-review__reason" data-checked={reason === r}>
                <input
                  type="radio"
                  name="crew-review-reason"
                  checked={reason === r}
                  aria-labelledby={`crew-review-reason-${r}`}
                  aria-describedby={`crew-review-impact-${r}`}
                  onChange={() => setReason(r)}
                />
                <span id={`crew-review-reason-${r}`}>{t[REASON_TEXT[r]]}</span>
                <span aria-hidden="true">{t.reasonSeparator}</span>
                <span id={`crew-review-impact-${r}`} className="crew-review__impact" data-impact={r === "wrong" ? "trust" : "none"}>
                  {r === "wrong" ? t.impactTrust : t.impactNone}
                </span>
              </label>
            ))}
          </div>
          <label className="crew-review__note-field">
            {t.note}
            <textarea value={note} placeholder={t.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="crew-review__buttons">
            <button type="button" className="secondary" onClick={() => setReturning(false)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="crew-review__confirm"
              disabled={reason === null}
              onClick={() => reason && decide({ workId, verdict: "returned", reason, ...(trimmed === "" ? {} : { note: trimmed }) })}
            >
              {saving ? t.saving : t.confirmReturn}
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

function formatDate(iso: string, language: LanguageCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

/** 交件時間「MM/DD HH:mm」（瀏覽器的時區，與工作帳本相同） */
function formatTime(iso: string, language: LanguageCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat(language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

const earlierRound = (round: number, work: string | null, t: Texts) =>
  work === null ? fill(t.earlierRoundNoRef, { round }) : fill(t.earlierRound, { round, work });
