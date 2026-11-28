// 驗收面板的少字版（#195，設計規格 v5；畫面以 docs/crew/design/v5/screens/13a～13c 為準）：
// 標題列（標題＋審查方式徽章＋「?」）→ 一行說明（員工・工作類型・相對期限＋「詳細」）→ 結論 → 請你確認＋系統檢查 → 交件 → 前幾輪 → 決定列。
// 說明只放在「?」裡；四項必要功能的入口見 ADR 0009「不能動的規則」。驗收時可以逐條回饋（#168，crew ADR 0008 第 12～14 點）。
// 資料只來自 readReviewPanel()；文字在 client/i18n/crew/review.<語言>.json。寫入行為與 v2 相同（createReview() 後重新讀取）。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { createReview, NewFeedback } from "../../db/store";
import type { ChangesView, ReturnReason, SpotCheck } from "../../trust/types";
import { crewStrings, type CrewTexts } from "../../i18n";
import { DetailsTip } from "../../../ui/DetailsTip";
import { Qmark } from "../../../ui/Qmark";
import { CheckTag, DueTag, EmployeeName, formatDueDate, VerdictLine, withEmployee } from "../components";
import type { ReviewPanel as PanelData, WorkListItem } from "../review";
import { workTypeLabel } from "../labels";
import { formatInZone, shortDate, shortDateTime } from "../../time";
import { assignmentRef, workRef } from "../refs";
import { BodyView, PointList, type ActivePoint } from "./BodyView";
import { decisionQuestion, deliverableName, verdictOf, type Audience } from "./conclusion";
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
  const verdict = verdictOf(focus.checks, { deliverable, body, audience, language });
  const name = deliverableName(deliverable, language);
  const employee = item.employee.displayName;
  const workType = workTypeLabel(item.workTypeId, language);
  const guidelineLabel = withEmployee(t.saveAsGuideline, { workType }, employee, language);
  // 「這次全部看」（#166）只在變更收成一行（只看標記處）時有作用
  const way =
    !focus.spotCheck && focus.level === "light" && panel.light
      ? { reason: panel.light, fullOnce: focus.changes.mode === "summary" ? { on: fullOnce, set: setFullOnce } : undefined }
      : null;
  return (
    <article ref={anchor} className="crew-review__panel" aria-labelledby="crew-review-title">
      <header className="crew-review__head">
        <div className="crew-review__title-row">
          <h2 id="crew-review-title" tabIndex={-1}>
            {item.title}
          </h2>
          {focus.spotCheck ? (
            <SpotBadge spot={focus.spotCheck} employee={employee} language={language} t={t} />
          ) : way ? (
            <LightWay
              reason={way.reason}
              every={panel.spotEvery}
              employee={employee}
              language={language}
              fullOnce={way.fullOnce}
              onOpenEmployee={onOpenEmployee && (() => onOpenEmployee(item.employee.id))}
              t={t}
            />
          ) : (
            <>
              <span className="ui-badge ui-badge--item" data-level="item">
                {t.levelItem}
              </span>
              <Qmark label={t.itemTipLabel} align="right">
                {withEmployee(t.itemTip, {}, employee, language)}
              </Qmark>
            </>
          )}
        </div>
        <p className="muted crew-review__line">
          <EmployeeName name={employee} language={language} />
          {t.lineSeparator}
          {workType}
          {item.due.kind !== "none" && (
            <>
              {t.lineSeparator}
              <DueTag due={item.due} language={language} />
            </>
          )}{" "}
          <DetailsTip items={detailItems(item, current, t, language)} language={language} />
        </p>
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
        {verdict && <VerdictLine tone={verdict.tone} text={verdict.text} />}
      </header>

      <section className="crew-review__pane" aria-label={t.paneLabel}>
        <div className="crew-review__confirm">
          <h3 id="crew-review-points-title">{withEmployee(t.pointsBy, { count: focus.points.length }, employee, language)}</h3>
          {focus.noPoints ? (
            <p className="crew-review__notice" role="note">
              {t.noPoints}
            </p>
          ) : (
            <PointList points={focus.points} body={body} language={language} active={active} onToggle={toggle} aside={pointAside} />
          )}
          <FollowedRows
            guidelines={panel.guidelines}
            pending={panel.pendingGuidelines}
            employee={employee}
            language={language}
            onOpenEmployee={onOpenEmployee && (() => onOpenEmployee(item.employee.id))}
            aside={guidelineAside}
            t={t}
          />
        </div>
        <div className="crew-review__system">
          <h3 id="crew-review-checks-title">{t.checks}</h3>
          {focus.checks.length === 0 ? (
            <p className="muted">{t.checksEmpty}</p>
          ) : (
            <ul className="crew-review__checks" aria-labelledby="crew-review-checks-title">
              {focus.checks.map((c) => (
                <li key={c.name}>
                  <CheckTag name={c.name} status={c.status} language={language} />
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <h3>{t.earlier}</h3>
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

/** 「詳細」的項目（#193）：來源與編號、交件時間、輪次、優先（一般不列）、到期日 */
function detailItems(item: WorkListItem, current: PanelData["current"], t: Texts, language: LanguageCode): string[] {
  const priority = item.priority === "high" ? t.detailsPriorityHigh : item.priority === "low" ? t.detailsPriorityLow : "";
  return [
    itemRef(item, t, language),
    fill(t.detailsSubmitted, { date: formatTime(current.submittedAt, language) }),
    fill(t.detailsRound, { round: current.round }),
    priority,
    item.dueAt === null ? "" : fill(t.detailsDue, { date: formatDueDate(item.dueAt, language) }),
  ];
}

/** 抽查（#166，ADR 0009「不能動的規則」）：虛線框徽章「抽查：這次全部看」＋「?」；沒有關閉或收起的按鈕 */
function SpotBadge({ spot, employee, language, t }: { spot: SpotCheck; employee: string; language: LanguageCode; t: Texts }) {
  return (
    <>
      <span className="ui-badge ui-badge--spot crew-review__spot" data-level="spot">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="9" cy="9" r="1.3" />
          <circle cx="15" cy="15" r="1.3" />
          <circle cx="15" cy="9" r="1.3" />
          <circle cx="9" cy="15" r="1.3" />
        </svg>
        {t.spotTag}
      </span>
      <Qmark label={t.spotTipLabel} align="right">
        {withEmployee(t.spotTip, { every: spot.every, ordinal: spot.ordinal }, employee, language)}
      </Qmark>
    </>
  );
}

interface LightWayProps {
  reason: LightReason;
  every: number;
  employee: string;
  language: LanguageCode;
  /** 「這次全部看」（#166：只影響這次怎麼看，不記錄）；沒有時兩格只是標示 */
  fullOnce?: { on: boolean; set: (on: boolean) => void };
  onOpenEmployee?: () => void;
  t: Texts;
}

/** 只看標記處：「只看標記處｜這次全部看」兩格（ui-way）＋「?」（依據與規則，連到員工頁的審查方式） */
function LightWay({ reason, every, employee, language, fullOnce, onOpenEmployee, t }: LightWayProps) {
  const full = fullOnce?.on ?? false;
  const option = (on: boolean, text: string, kind: "mark" | "all") => {
    const className = `ui-way__opt${on ? ` ui-way__opt--${kind}` : ""}`;
    return fullOnce ? (
      <button type="button" className={className} aria-pressed={on} onClick={() => fullOnce.set(kind === "all")}>
        {text}
      </button>
    ) : (
      <span className={className}>{text}</span>
    );
  };
  return (
    <>
      <span className="ui-way" role="group" aria-label={t.wayLabel} data-level="light">
        {option(!full, t.levelLight, "mark")}
        {option(full, t.fullOnce, "all")}
      </span>
      <Qmark label={t.lightTipLabel} align="right">
        {withEmployee(t.lightTip, { count: reason.recent, date: shortDate(reason.relaxedAt, language), every }, employee, language)}
        {onOpenEmployee && (
          <>
            <br />
            <button type="button" className="link" onClick={onOpenEmployee}>
              {withEmployee(t.openEmployeeWay, {}, employee, language)}
            </button>
          </>
        )}
      </Qmark>
    </>
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
 * 這次依照的守則（#147，crew ADR 0007 決定 5）：「請你確認」最後一列「照守則：…」＋「?」（全文、何時記下、有沒有做到由你判斷）。
 * 下方是等確認的守則（只有能驗收的身分，pending > 0）；兩者都沒有時不顯示。
 */
function FollowedRows({ guidelines, pending, employee, language, onOpenEmployee, aside, t }: FollowedProps) {
  if (guidelines.length === 0 && pending === 0) return null;
  return (
    <>
      {guidelines.length > 0 && (
        <ul className="crew-review__followed-list">
          {guidelines.map((g) => {
            const extra = aside?.(g);
            const origin = fill(g.proposerKind === "human" ? t.followedSavedOnReturn : t.followedConfirmed, { date: shortDate(g.since, language) }, language);
            return (
              <li key={g.id} className="crew-review__followed-row">
                <svg className="crew-review__followed-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M6 3h12v18l-6-4-6 4z" />
                </svg>
                <span className="crew-review__followed-text">{fill(t.guidelineRow, { text: g.text })}</span>
                <Qmark label={t.guidelineTipLabel} align="right">
                  {g.text}
                  <br />
                  {origin}
                  {g.retiredLater && t.followedRetiredLater}
                  {t.clauseSeparator}
                  {t.guidelineJudge}
                </Qmark>
                {extra}
              </li>
            );
          })}
        </ul>
      )}
      {pending > 0 && (
        <div className="crew-review__followed-pending" role="note">
          <p>{withEmployee(t.pendingGuidelines, { count: pending }, employee, language)}</p>
          {onOpenEmployee && (
            <button type="button" className="secondary" onClick={onOpenEmployee}>
              {t.pendingGuidelinesOpen}
            </button>
          )}
        </div>
      )}
    </>
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
