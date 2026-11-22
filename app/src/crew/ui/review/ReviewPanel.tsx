// 驗收面板 v3（#72 計畫第 1、5 點；設計規格 v3 第 6.2 節）：標題卡（結論列）→ 重點＋自動檢查 → 交件本身 → 前幾輪 → 決定列。
// 資料只來自 readReviewPanel()；文字在 client/i18n/crew/review.<語言>.json。寫入行為與 v2 相同（createReview() 後重新讀取）。
import { useEffect, useRef, useState, type RefObject } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { createReview } from "../../db/store";
import type { ReturnReason } from "../../trust/types";
import { crewStrings, type CrewTexts } from "../../i18n";
import { CheckRow, ConclusionRow, LevelBadge, withEmployee } from "../components";
import type { ReviewPanel as PanelData, WorkListItem } from "../review";
import { workTypeLabel } from "../labels";
import { assignmentRef, workRef } from "../refs";
import { BodyView, PointList, type ActivePoint } from "./BodyView";
import { conclusionOf, decisionQuestion, deliverableName, type Audience } from "./conclusion";
import type { LightReason } from "./light";

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
  /** 剛才的「通過」因為沒有上傳權限而沒有收進知識庫（#92 的 `## 決定` 4） */
  noUpload?: boolean;
  /** 打開回流文件的原文；沒有時不顯示「打開原文」 */
  onOpenSource?: (passageId: string) => void;
  /** 切到信任頁；沒有時不顯示「看信任紀錄」 */
  onOpenTrust?: () => void;
}

export function ReviewPanel({ anchor, panel, language, saving, saveFailed, decide, noUpload = false, onOpenSource, onOpenTrust }: PanelProps) {
  const t = crewStrings("review", language);
  const { item, focus, current, earlier, body, deliverable } = panel;
  // 選中的重點只存在元件 state；換一筆工作時（key 改變）重設
  const [active, setActive] = useState<ActivePoint>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toggle = (n: number) => {
    const next = active === n ? null : n;
    setActive(next);
    if (next !== null) revealPoint(bodyRef.current, next);
  };
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
        <KnowledgeStatus passage={panel.knowledgePassage} noUpload={noUpload} onOpenSource={onOpenSource} t={t} />
        {conclusion && (
          <ConclusionRow
            tone={conclusion.tone}
            title={conclusion.title}
            description={withEmployee(conclusion.description, {}, item.employee.displayName, language)}
          />
        )}
      </header>
      {focus.level === "light" && panel.light && (
        <LightCard reason={panel.light} employee={item.employee.displayName} workType={workTypeLabel(item.workTypeId, language)} language={language} onOpenTrust={onOpenTrust} t={t} />
      )}

      <div className="crew-review__pair">
        <section className="card crew-review__section">
          <h4>{t.points}</h4>
          <p className="muted crew-review__by">{withEmployee(t.pointsBy, {}, item.employee.displayName, language)}</p>
          {focus.noPoints ? (
            <p className="crew-review__notice" role="note">
              {t.noPoints}
            </p>
          ) : (
            <PointList points={focus.points} body={body} language={language} active={active} onToggle={toggle} />
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

      <div ref={bodyRef}>
        <BodyView
          name={name}
          body={body}
          raw={focus.body.text}
          changes={focus.changes}
          changeItems={panel.changeItems}
          language={language}
          active={active}
          deliverable={deliverable}
          reference={deliverable === "code" ? itemRef(item, t, language) : null}
        />
      </div>

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

interface LightCardProps {
  reason: LightReason;
  employee: string;
  workType: string;
  language: LanguageCode;
  onOpenTrust?: () => void;
  t: Texts;
}

/** 為什麼是少看（規格 6.3）：success 1px 框、盾牌圖示；何時同意、最近幾次沒有做錯、收起什麼、一次做錯了就改回逐項看 */
function LightCard({ reason, employee, workType, language, onOpenTrust, t }: LightCardProps) {
  const since = withEmployee(t.lightSince, { date: formatDate(reason.relaxedAt, language), workType, count: reason.recent }, employee, language);
  return (
    <section className="crew-review__light" aria-labelledby="crew-review-light-title">
      <svg className="crew-icon crew-review__light-icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9c-4-1.5-7-4.5-7-9V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 12l2 2l4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="crew-review__light-text">
        <h4 id="crew-review-light-title">{t.lightTitle}</h4>
        <p>{since}</p>
        <p>{t.lightRule}</p>
        {onOpenTrust && (
          <button type="button" className="link" onClick={onOpenTrust}>
            {t.lightTrust}
          </button>
        )}
      </div>
    </section>
  );
}

/** 回流知識庫的狀態（#92）：已收進知識庫（可打開原文），或剛才的通過因為沒有上傳權限而沒有收進；其他情況不顯示 */
function KnowledgeStatus({ passage, noUpload, onOpenSource, t }: { passage: string | null; noUpload: boolean; onOpenSource?: (passageId: string) => void; t: Texts }) {
  if (passage !== null) {
    return (
      <p className="crew-review__knowledge">
        <span className="badge" data-knowledge="flowed">
          {t.knowledgeFlowed}
        </span>{" "}
        {onOpenSource && (
          <button type="button" className="chip" onClick={() => onOpenSource(passage)}>
            {t.knowledgeOpen}
          </button>
        )}
      </p>
    );
  }
  if (!noUpload) return null;
  return (
    <p className="crew-review__notice" role="note">
      {t.knowledgeNoUpload}
    </p>
  );
}

interface DecisionProps {
  question: string;
  workId: string;
  saving: boolean;
  decide: Decide;
  t: Texts;
}

/**
 * 決定列：問句＋退回（次要）＋通過（主要）；按退回後展開三張原因卡，「確定退回」是墨色實心按鈕。
 * 手機（#103）的決定列固定在底部分頁列之上（ReviewView.css）；展開退回原因時取消固定、回到面板最後，並把原因捲進畫面。
 */
function DecisionBar({ question, workId, saving, decide, t }: DecisionProps) {
  // 退回的表單只存在元件 state；換一筆工作時（key 改變）重設
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (returning && bar?.closest(".app--phone")) bar.scrollIntoView?.({ block: "nearest" });
  }, [returning]);
  return (
    <section ref={ref} className="card crew-review__decision" data-returning={returning}>
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

/** 把第 n 個重點在內容中的第一個位置捲進畫面；位置在收起的 details 裡時先展開 */
function revealPoint(root: HTMLElement | null, n: number) {
  const target = root?.querySelector<HTMLElement>(`[data-point~="${n}"]`);
  if (!target) return;
  const details = target.closest("details");
  if (details) details.open = true;
  target.scrollIntoView?.({ block: "nearest" });
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
