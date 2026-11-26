// 驗收面板 v3（#72 計畫第 1、5 點；設計規格 v3 第 6.2 節）：標題卡（結論列）→ 重點＋自動檢查 → 交件本身 → 前幾輪 → 決定列。
// 重點與依照的守則包在「員工自己說的」、自動檢查包在「獨立檢查」（#168，crew ADR 0008 第 16 點）；驗收時可以逐條回饋（第 12～14 點）。
// 資料只來自 readReviewPanel()；文字在 client/i18n/crew/review.<語言>.json。寫入行為與 v2 相同（createReview() 後重新讀取）。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { createReview, NewFeedback } from "../../db/store";
import type { ChangesView, ReturnReason, SpotCheck } from "../../trust/types";
import { crewStrings, type CrewTexts } from "../../i18n";
import { CheckRow, ConclusionRow, LevelBadge, ScheduleLine, withEmployee } from "../components";
import type { ReviewPanel as PanelData, WorkListItem } from "../review";
import { workTypeLabel } from "../labels";
import { formatInZone, shortDate, shortDateTime } from "../../time";
import { assignmentRef, workRef } from "../refs";
import { BodyView, PointList, type ActivePoint } from "./BodyView";
import { conclusionOf, decisionQuestion, deliverableName, type Audience } from "./conclusion";
import { CorrectionDone, CorrectionForm, type Correct } from "./Correction";
import { FeedbackTag, FeedbackToggle } from "./FeedbackMarks";
import { feedbackInput, GUIDELINE_RESULTS, NO_MARKS, POINT_RESULTS, storedMarks, toggled, type Marks } from "./feedback";
import type { FollowedGuideline } from "./followed";
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
  /** 記下事後更正（#164）；沒有時不顯示「通過後發現有錯」 */
  correct?: Correct;
  /** 剛才的「通過」因為沒有上傳權限而沒有收進知識庫（#92 的 `## 決定` 4） */
  noUpload?: boolean;
  /** 剛才的退回已記成守則（#145） */
  savedGuideline?: boolean;
  /** 打開回流文件的原文；沒有時不顯示「打開原文」 */
  onOpenSource?: (passageId: string) => void;
  /** 切到信任頁；沒有時不顯示「看信任紀錄」 */
  onOpenTrust?: () => void;
  /** 切到「員工」並捲到該員工卡（#147：等確認的守則）；沒有時不顯示「到員工頁確認」 */
  onOpenEmployee?: (employeeId: string) => void;
}

export function ReviewPanel({ anchor, panel, language, saving, saveFailed, decide, correct, noUpload = false, savedGuideline = false, onOpenSource, onOpenTrust, onOpenEmployee }: PanelProps) {
  const t = crewStrings("review", language);
  const { item, focus, current, earlier, body, deliverable } = panel;
  // 選中的重點只存在元件 state；換一筆工作時（key 改變）重設
  const [active, setActive] = useState<ActivePoint>(null);
  // 「這次逐項看」（#166，crew ADR 0008 第 10 點）：只存在元件 state，不寫入資料；換一筆工作時（key 改變）回到預設
  const [fullOnce, setFullOnce] = useState(false);
  const changes: ChangesView = fullOnce && focus.changes.mode === "summary" ? { mode: "items", items: [...panel.changeItems] } : focus.changes;
  // 逐條回饋（#168）：選中的標記只存在元件 state，按「通過」或送出退回時一起寫入；換一筆工作時（key 改變）重設
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const shown = panel.feedback && storedMarks(panel.feedback);
  const pointAside = (n: number, text: string) =>
    panel.canDecide ? (
      <FeedbackToggle item={text} results={POINT_RESULTS} selected={marks.points.get(n)} disabled={saving} onSelect={(r) => setMarks({ ...marks, points: toggled(marks.points, n, r) })} t={t} />
    ) : (
      <FeedbackTag result={shown?.points.get(n)} t={t} />
    );
  const guidelineAside = (g: FollowedGuideline) =>
    panel.canDecide ? (
      <FeedbackToggle item={g.text} results={GUIDELINE_RESULTS} selected={marks.guidelines.get(g.id)} disabled={saving} onSelect={(r) => setMarks({ ...marks, guidelines: toggled(marks.guidelines, g.id, r) })} t={t} />
    ) : (
      <FeedbackTag result={shown?.guidelines.get(g.id)} t={t} />
    );
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
  const workType = workTypeLabel(item.workTypeId, language);
  const guidelineLabel = withEmployee(t.saveAsGuideline, { workType }, item.employee.displayName, language);
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
        <h3 id="crew-review-title" tabIndex={-1}>
          {item.title}
        </h3>
        <p className="muted">{meta}</p>
        <ScheduleLine item={item} language={language} />
        {item.verdict !== null && (
          <p>
            <span className="badge" data-verdict={item.verdict}>
              {item.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
            </span>
            {panel.returned && <ReturnedReason reason={panel.returned.reason} notInPoints={panel.returned.notInPoints} t={t} />}
          </p>
        )}
        {/* 事後更正（#164）：在「已通過」下方；已有更正時只顯示紀錄 */}
        {panel.correction !== null ? (
          <CorrectionDone correctedAt={panel.correction.correctedAt} note={panel.correction.note} language={language} t={t} />
        ) : (
          panel.canCorrect && panel.reviewId !== null && correct && (
            <CorrectionForm
              reviewId={panel.reviewId}
              guidelineLabel={guidelineLabel}
              consequence={focus.level === "light" ? fill(t.correctionConsequenceLight, { workType }) : t.correctionConsequenceItem}
              saving={saving}
              correct={correct}
              t={t}
            />
          )
        )}
        {savedGuideline && (
          <p className="crew-review__notice" role="status">
            {t.guidelineSaved}
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
      {focus.spotCheck ? (
        <SpotCard spot={focus.spotCheck} onOpenTrust={onOpenTrust} t={t} />
      ) : (
        focus.level === "light" &&
        panel.light && (
          <LightCard
            reason={panel.light}
            employee={item.employee.displayName}
            workType={workType}
            language={language}
            onOpenTrust={onOpenTrust}
            // 變更已逐項列出（沒標重點）時不需要「這次逐項看」
            fullOnce={focus.changes.mode === "summary" ? { on: fullOnce, toggle: () => setFullOnce(!fullOnce) } : undefined}
            t={t}
          />
        )
      )}

      <section className="crew-review__zone" aria-labelledby="crew-review-zone-self">
        <h4 id="crew-review-zone-self">{t.groupSelf}</h4>
        <p className="muted crew-review__by">{t.groupSelfHint}</p>
        {panel.canDecide && <p className="muted crew-review__by">{t.feedbackHint}</p>}
        <div className="crew-review__pair">
          <section className="card crew-review__section" aria-labelledby="crew-review-points-title">
            <h5 id="crew-review-points-title">{t.points}</h5>
            <p className="muted crew-review__by">{withEmployee(t.pointsBy, {}, item.employee.displayName, language)}</p>
            {focus.noPoints ? (
              <p className="crew-review__notice" role="note">
                {t.noPoints}
              </p>
            ) : (
              <PointList points={focus.points} body={body} language={language} active={active} onToggle={toggle} aside={pointAside} />
            )}
          </section>
          <FollowedCard
            guidelines={panel.guidelines}
            pending={panel.pendingGuidelines}
            employee={item.employee.displayName}
            language={language}
            onOpenEmployee={onOpenEmployee && (() => onOpenEmployee(item.employee.id))}
            aside={guidelineAside}
            t={t}
          />
        </div>
      </section>
      <section className="crew-review__zone" aria-labelledby="crew-review-zone-independent">
        <h4 id="crew-review-zone-independent">{t.groupIndependent}</h4>
        <p className="muted crew-review__by">{t.groupIndependentHint}</p>
        <section className="card crew-review__section" aria-labelledby="crew-review-checks-title">
          <h5 id="crew-review-checks-title">{t.checks}</h5>
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
      </section>

      <div ref={bodyRef}>
        <BodyView
          name={name}
          body={body}
          raw={focus.body.text}
          changes={changes}
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
                  {w.review.reason && <ReturnedReason reason={w.review.reason} notInPoints={w.review.notInPoints} t={t} />}
                  {w.review.note && <span className="muted crew-review__note">{w.review.note}</span>}
                </p>
              )}
              {w.review && w.review.feedback.length > 0 && (
                <ul className="crew-review__feedback-list">
                  {w.review.feedback.map((f, i) => (
                    <li key={i}>
                      <span>{f.text}</span> <FeedbackTag result={f.result} t={t} />
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </section>
      )}

      {panel.canDecide ? (
        <DecisionBar
          question={decisionQuestion(deliverable, language)}
          workId={current.id}
          guidelineLabel={guidelineLabel}
          feedback={feedbackInput(marks)}
          saving={saving}
          decide={decide}
          t={t}
        />
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
  /** 「這次逐項看」的狀態與切換（#166）；沒有時不顯示按鈕 */
  fullOnce?: { on: boolean; toggle: () => void };
  t: Texts;
}

const TrustLink = ({ onOpenTrust, t }: { onOpenTrust?: () => void; t: Texts }) =>
  onOpenTrust ? (
    <button type="button" className="link" onClick={onOpenTrust}>
      {t.lightTrust}
    </button>
  ) : null;

/** 這次抽查（#166，crew ADR 0008 第 8、9 點）：warning 1px 框、警示圖示；每 N 件抽 1 件、這是第幾件、判定的規則 */
function SpotCard({ spot, onOpenTrust, t }: { spot: SpotCheck; onOpenTrust?: () => void; t: Texts }) {
  return (
    <section className="crew-review__light crew-review__spot" aria-labelledby="crew-review-spot-title">
      <svg className="crew-icon crew-review__light-icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3l9.5 17h-19z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 10v4M12 17v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="crew-review__light-text">
        <h4 id="crew-review-spot-title">{t.spotTitle}</h4>
        <p>{fill(t.spotWhy, { every: spot.every, ordinal: spot.ordinal })}</p>
        <p>{t.spotRule}</p>
        <TrustLink onOpenTrust={onOpenTrust} t={t} />
      </div>
    </section>
  );
}

/** 為什麼是看重點（規格 6.3）：success 1px 框、盾牌圖示；何時同意、最近幾次沒有做錯、收起什麼、一次做錯了就改回逐項看 */
function LightCard({ reason, employee, workType, language, onOpenTrust, fullOnce, t }: LightCardProps) {
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
        <TrustLink onOpenTrust={onOpenTrust} t={t} />
        {fullOnce && (
          <div className="crew-review__full-once">
            <button type="button" className="secondary" aria-pressed={fullOnce.on} onClick={fullOnce.toggle}>
              {fullOnce.on ? t.fullOnceBack : t.fullOnce}
            </button>
            {fullOnce.on && (
              <span className="muted" role="status">
                {t.fullOnceNote}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface FollowedProps {
  guidelines: FollowedGuideline[];
  pending: number;
  employee: string;
  language: LanguageCode;
  onOpenEmployee?: () => void;
  /** 每條守則旁的逐條回饋（#168：切換按鈕或唯讀標籤） */
  aside?: (g: FollowedGuideline) => ReactNode;
  t: Texts;
}

/**
 * 這次依照的守則（#147，crew ADR 0007 決定 5）：員工自述，有沒有做到由人判斷；不論層級都顯示。
 * 下方是等確認的守則（只有能驗收的身分，pending > 0）；沒有依照任何守則時只留這一行，兩者都沒有時不顯示。
 */
function FollowedCard({ guidelines, pending, employee, language, onOpenEmployee, aside, t }: FollowedProps) {
  if (guidelines.length === 0 && pending === 0) return null;
  const pendingRow = pending > 0 && (
    <div className="crew-review__followed-pending" role="note">
      <p>{withEmployee(t.pendingGuidelines, { count: pending }, employee, language)}</p>
      {onOpenEmployee && (
        <button type="button" className="secondary" onClick={onOpenEmployee}>
          {t.pendingGuidelinesOpen}
        </button>
      )}
    </div>
  );
  if (guidelines.length === 0) return <div className="card crew-review__section crew-review__followed">{pendingRow}</div>;
  return (
    <section className="card crew-review__section crew-review__followed" aria-labelledby="crew-review-followed-title">
      <div className="crew-review__followed-head">
        <h5 id="crew-review-followed-title">{t.followedTitle}</h5>
        <span className="badge crew-review__self-reported">{withEmployee(t.followedBy, {}, employee, language)}</span>
      </div>
      <p className="muted crew-review__by">{t.followedJudge}</p>
      <ul className="crew-review__followed-list">
        {guidelines.map((g) => {
          const extra = aside?.(g);
          return (
            <li key={g.id} className={extra ? "crew-review__followed-row" : undefined}>
              <div className="crew-review__followed-text">
                <span>{g.text}</span>
                <span className="muted crew-review__followed-origin">
                  {fill(g.proposerKind === "human" ? t.followedSavedOnReturn : t.followedConfirmed, { date: shortDate(g.since, language) }, language)}
                  {g.retiredLater && t.followedRetiredLater}
                </span>
              </div>
              {extra}
            </li>
          );
        })}
      </ul>
      {pendingRow}
    </section>
  );
}

/** 退回原因；勾了「這個錯沒有被標成重點」時接在後面（#168） */
function ReturnedReason({ reason, notInPoints, t }: { reason: ReturnReason; notInPoints: boolean; t: Texts }) {
  return (
    <>
      {" "}
      <span>{t[REASON_TEXT[reason]]}</span>
      {notInPoints && <span className="badge crew-review__not-in-points">{t.notInPointsShown}</span>}
    </>
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
  /** 「記成 ○○ 的「工作類型」守則」（#145） */
  guidelineLabel: ReactNode;
  /** 逐條回饋（#168）；沒有標記時是 undefined */
  feedback?: NewFeedback;
  saving: boolean;
  decide: Decide;
  t: Texts;
}

/**
 * 決定列：問句＋退回（次要）＋通過（主要）；按退回後展開三張原因卡，「確定退回」是墨色實心按鈕。
 * 手機（#103）的決定列固定在底部分頁列之上（ReviewView.css）；展開退回原因時取消固定、回到面板最後，並把原因捲進畫面。
 */
function DecisionBar({ question, workId, guidelineLabel, feedback, saving, decide, t }: DecisionProps) {
  // 退回的表單只存在元件 state；換一筆工作時（key 改變）重設
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  // 記成守則（#145，ADR 0007 決定 2）：「流程上的小問題」不能成為守則；意見是空的時按「確定退回」才顯示錯誤（不用停用的按鈕）
  const [asGuideline, setAsGuideline] = useState(false);
  const [guidelineError, setGuidelineError] = useState(false);
  // 「這個錯沒有被標成重點」（#168，ADR 0008 第 15 點）：只在原因是「做錯了」時出現；換成其他原因時取消勾選
  const [notInPoints, setNotInPoints] = useState(false);
  const withFeedback = feedback ? { feedback } : {};
  const trimmed = note.trim();
  const guidelineAllowed = reason !== null && reason !== "process";
  const confirmReturn = () => {
    if (reason === null) return;
    const save = guidelineAllowed && asGuideline;
    if (save && trimmed === "") {
      setGuidelineError(true);
      return;
    }
    void decide({
      workId,
      verdict: "returned",
      reason,
      ...(trimmed === "" ? {} : { note: trimmed }),
      ...(save ? { saveAsGuideline: true } : {}),
      ...(reason === "wrong" && notInPoints ? { notInPoints: true } : {}),
      ...withFeedback,
    });
  };
  const ref = useRef<HTMLElement>(null);
  // 焦點（#153 第 1 點，WCAG 2.4.3）：打開退回表單時移到第一個原因；按「取消」關閉時回到「退回」按鈕。初次顯示時不移動
  const firstReason = useRef<HTMLInputElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const openReturn = (open: boolean) => {
    toggled.current = true;
    setReturning(open);
  };
  useEffect(() => {
    const bar = ref.current;
    if (returning && bar?.closest(".app--phone")) bar.scrollIntoView?.({ block: "nearest" });
    if (!toggled.current) return;
    toggled.current = false;
    (returning ? firstReason.current : returnButton.current)?.focus();
  }, [returning]);
  return (
    <section ref={ref} className="card crew-review__decision" data-returning={returning}>
      {!returning ? (
        <div className="crew-review__decision-row">
          <p className="crew-review__question">{question}</p>
          <div className="crew-review__buttons">
            <button ref={returnButton} type="button" className="secondary" disabled={saving} onClick={() => openReturn(true)}>
              {t.return}
            </button>
            <button type="button" disabled={saving} onClick={() => decide({ workId, verdict: "accepted", ...withFeedback })}>
              {saving ? t.saving : t.accept}
            </button>
          </div>
        </div>
      ) : (
        <fieldset className="crew-review__return" disabled={saving}>
          <legend>{t.returnReason}</legend>
          <div className="crew-review__reasons">
            {REASONS.map((r, i) => (
              <label key={r} className="crew-review__reason" data-checked={reason === r}>
                <input
                  ref={i === 0 ? firstReason : undefined}
                  type="radio"
                  name="crew-review-reason"
                  checked={reason === r}
                  aria-labelledby={`crew-review-reason-${r}`}
                  aria-describedby={`crew-review-impact-${r}`}
                  onChange={() => {
                    setReason(r);
                    if (r !== "wrong") setNotInPoints(false);
                  }}
                />
                <span id={`crew-review-reason-${r}`}>{t[REASON_TEXT[r]]}</span>
                <span aria-hidden="true">{t.reasonSeparator}</span>
                <span id={`crew-review-impact-${r}`} className="crew-review__impact" data-impact={r === "wrong" ? "trust" : "none"}>
                  {r === "wrong" ? t.impactTrust : t.impactNone}
                </span>
              </label>
            ))}
          </div>
          {reason === "wrong" && (
            <label className="crew-review__guideline-check">
              <input type="checkbox" checked={notInPoints} onChange={(e) => setNotInPoints(e.target.checked)} />
              <span>{t.correctionNotInPoints}</span>
            </label>
          )}
          <label className="crew-review__note-field">
            {/* 勾選「記成守則」後意見是必填，標籤跟著改（#146 的修正要求） */}
            {guidelineAllowed && asGuideline ? t.noteRequired : t.note}
            <textarea
              value={note}
              placeholder={t.notePlaceholder}
              onChange={(e) => {
                setNote(e.target.value);
                setGuidelineError(false);
              }}
            />
          </label>
          {guidelineAllowed && (
            <div className="crew-review__guideline">
              <label className="crew-review__guideline-check">
                <input
                  type="checkbox"
                  checked={asGuideline}
                  aria-describedby={`crew-review-guideline-hint${guidelineError ? " crew-review-guideline-error" : ""}`}
                  aria-invalid={guidelineError || undefined}
                  onChange={(e) => {
                    setAsGuideline(e.target.checked);
                    setGuidelineError(false);
                  }}
                />
                <span>{guidelineLabel}</span>
              </label>
              <p id="crew-review-guideline-hint" className="muted crew-review__guideline-hint">
                {t.saveAsGuidelineHint}
              </p>
              {guidelineError && (
                <p id="crew-review-guideline-error" className="error" role="alert">
                  {t.guidelineNeedsNote}
                </p>
              )}
            </div>
          )}
          <div className="crew-review__buttons">
            <button type="button" className="secondary" onClick={() => openReturn(false)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="crew-review__confirm"
              disabled={reason === null}
              aria-describedby={reason === null ? "crew-review-confirm-hint" : undefined}
              onClick={confirmReturn}
            >
              {saving ? t.saving : t.confirmReturn}
            </button>
          </div>
          {/* 還沒選原因時「確定退回」是停用的，提示原因（#153 第 1 點） */}
          {reason === null && (
            <p id="crew-review-confirm-hint" className="muted crew-review__confirm-hint">
              {t.confirmReturnHint}
            </p>
          )}
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

// 交件日與交件時間以展示公司的時區顯示（#153 第 8 點）
const formatDate = (iso: string, language: LanguageCode) => formatInZone(iso, language, { dateStyle: "medium" });
/** 交件時間「MM/DD HH:mm」 */
const formatTime = shortDateTime;

const earlierRound = (round: number, work: string | null, t: Texts) =>
  work === null ? fill(t.earlierRoundNoRef, { round }) : fill(t.earlierRound, { round, work });
