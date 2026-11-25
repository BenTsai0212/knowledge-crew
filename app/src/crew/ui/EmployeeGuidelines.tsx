// 員工卡的「守則」區塊（#145，ADR 0007）：摘要一行；等確認的守則（確認、修改後確認、不採用）排最前，再來是生效的（收回）；
// 已收回與不採用的收在一行，點了展開，不能再操作。每條都有「看那次退回」。資料整理在 employees.ts（groupGuidelines()），
// 決定的按鈕只給能驗收的身分；寫入在 EmployeesView.tsx（decideGuideline() 後重新讀取）。
// 有等確認的守則時區塊帶 data-pending（導覽的「守則」一步以此標出，#151）。
import { useState, type ReactNode } from "react";
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { NewGuidelineDecision } from "../db/store";
import { crewStrings, type CrewTexts } from "../i18n";
import { withEmployee } from "./components";
import type { EmployeeGuideline, EmployeeGuidelines } from "./employees";
import { shortDate } from "./trust";

type T = CrewTexts<"employees">;
type Decide = (input: NewGuidelineDecision) => void;

interface Props {
  employee: { id: string; displayName: string };
  guidelines: EmployeeGuidelines;
  canReview: boolean;
  /** 有寫入進行中：決定的按鈕暫時不能按，避免重複寫入 */
  saving: boolean;
  /** 剛才的寫入失敗（例如狀態已改變） */
  failed: boolean;
  language: LanguageCode;
  decide: Decide;
  /** 「看那次退回」：切到「工作與驗收」並選該交辦 */
  openReturn?: (assignmentId: string) => void;
}

/** 摘要「守則 n 條・等你確認 n 條」：0 的那段不顯示，都沒有時是「還沒有守則」 */
export function guidelineSummary(g: Pick<EmployeeGuidelines, "active" | "pending">, canReview: boolean, language: LanguageCode): string {
  const t = crewStrings("employees", language);
  const parts: string[] = [];
  if (g.active.length > 0) parts.push(fill(t.guidelinesActive, { count: g.active.length }, language));
  if (g.pending.length > 0) parts.push(fill(canReview ? t.guidelinesPending : t.guidelinesPendingOthers, { count: g.pending.length }, language));
  return parts.length === 0 ? t.guidelinesNone : parts.join(t.guidelinesSeparator);
}

/** 「已收回 n 條・不採用 n 條」（0 的那段不顯示） */
export function closedSummary(closed: readonly EmployeeGuideline[], language: LanguageCode): string {
  const t = crewStrings("employees", language);
  const revoked = closed.filter((g) => g.status === "revoked").length;
  const rejected = closed.length - revoked;
  const parts: string[] = [];
  if (revoked > 0) parts.push(fill(t.guidelinesRetired, { count: revoked }, language));
  if (rejected > 0) parts.push(fill(t.guidelinesDeclined, { count: rejected }, language));
  return parts.join(t.guidelinesSeparator);
}

export function EmployeeGuidelineSection({ employee, guidelines, canReview, saving, failed, language, decide, openReturn }: Props) {
  const t = crewStrings("employees", language);
  const { pending, active, closed } = guidelines;
  const titleId = `crew-employee-guidelines-${employee.id}`;
  const item = (g: EmployeeGuideline) => (
    <GuidelineItem key={g.id} g={g} employee={employee.displayName} canReview={canReview} saving={saving} language={language} decide={decide} openReturn={openReturn} t={t} />
  );
  return (
    <section className="crew-employees__guidelines" aria-labelledby={titleId} data-pending={pending.length > 0 || undefined}>
      <h4 id={titleId}>{t.guidelinesTitle}</h4>
      <p className="muted">{guidelineSummary(guidelines, canReview, language)}</p>
      {failed && (
        <p className="error" role="alert">
          {t.guidelineStale}
        </p>
      )}
      {pending.length + active.length > 0 && <ul className="crew-employees__guideline-list">{[...pending, ...active].map(item)}</ul>}
      {closed.length > 0 && (
        <details className="crew-employees__guideline-closed">
          <summary>{closedSummary(closed, language)}</summary>
          <ul className="crew-employees__guideline-list">{closed.map(item)}</ul>
        </details>
      )}
    </section>
  );
}

interface ItemProps {
  g: EmployeeGuideline;
  employee: string;
  canReview: boolean;
  saving: boolean;
  language: LanguageCode;
  decide: Decide;
  openReturn?: (assignmentId: string) => void;
  t: T;
}

function origin(g: EmployeeGuideline, employee: string, t: T, language: LanguageCode): ReactNode {
  const date = (iso: string) => shortDate(iso, language);
  if (g.proposerKind === "human") return fill(t.guidelineSavedOnReturn, { date: date(g.proposedAt) }, language);
  if (g.confirmedAt === null) return withEmployee(t.guidelineFromReturn, { date: date(g.returnedAt) }, employee, language);
  return withEmployee(t.guidelineDraftedConfirmed, { proposed: date(g.proposedAt), confirmed: date(g.confirmedAt) }, employee, language);
}

function GuidelineItem({ g, employee, canReview, saving, language, decide, openReturn, t }: ItemProps) {
  // 修改後確認與收回的確認只存在元件 state
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(g.proposedText);
  const [emptyError, setEmptyError] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const errorId = `crew-guideline-edit-error-${g.id}`;
  const confirmEdit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setEmptyError(true);
      return;
    }
    // 沒有改動時就是一般的確認
    decide(trimmed === g.proposedText ? { guidelineId: g.id, decision: "confirm" } : { guidelineId: g.id, decision: "confirm", revisedText: trimmed });
  };
  const closedAt = g.closedAt && fill(g.status === "revoked" ? t.guidelineRetiredAt : t.guidelineDeclinedAt, { date: shortDate(g.closedAt, language) }, language);
  return (
    <li className="crew-employees__guideline" data-status={g.status}>
      <p className="crew-employees__guideline-text">{g.text}</p>
      <p className="muted crew-employees__guideline-meta">
        <span>
          {origin(g, employee, t, language)}
          {g.revised && t.guidelineRevised}
        </span>
        {g.status === "active" && <span>{fill(t.guidelineFollowed, { count: g.followed }, language)}</span>}
        {closedAt && <span>{closedAt}</span>}
      </p>
      <div className="crew-employees__guideline-actions">
        {openReturn && (
          <button type="button" className="link" onClick={() => openReturn(g.sourceAssignmentId)}>
            {t.guidelineOpenReturn}
          </button>
        )}
        {canReview && g.status === "pending" && !editing && (
          <>
            <button type="button" disabled={saving} onClick={() => decide({ guidelineId: g.id, decision: "confirm" })}>
              {t.guidelineConfirm}
            </button>
            <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(true)}>
              {t.guidelineEditConfirm}
            </button>
            <button type="button" className="secondary" disabled={saving} onClick={() => decide({ guidelineId: g.id, decision: "reject" })}>
              {t.guidelineDecline}
            </button>
          </>
        )}
        {canReview && g.status === "active" && !retiring && (
          <button type="button" className="secondary" disabled={saving} onClick={() => setRetiring(true)}>
            {t.guidelineRetire}
          </button>
        )}
      </div>
      {canReview && g.status === "pending" && editing && (
        <div className="crew-employees__guideline-form">
          <label>
            {t.guidelineEditLabel}
            <textarea
              value={text}
              aria-invalid={emptyError || undefined}
              aria-describedby={emptyError ? errorId : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setEmptyError(false);
              }}
            />
          </label>
          {emptyError && (
            <p id={errorId} className="error" role="alert">
              {t.guidelineEditEmpty}
            </p>
          )}
          <div className="crew-employees__guideline-actions">
            <button type="button" disabled={saving} onClick={confirmEdit}>
              {t.guidelineConfirm}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(false);
                setText(g.proposedText);
                setEmptyError(false);
              }}
            >
              {t.guidelineCancel}
            </button>
          </div>
        </div>
      )}
      {canReview && g.status === "active" && retiring && (
        <div className="crew-employees__guideline-form" role="group" aria-label={t.guidelineRetire}>
          <p>{t.guidelineRetireAsk}</p>
          <div className="crew-employees__guideline-actions">
            <button type="button" disabled={saving} onClick={() => decide({ guidelineId: g.id, decision: "revoke" })}>
              {t.guidelineRetire}
            </button>
            <button type="button" className="secondary" onClick={() => setRetiring(false)}>
              {t.guidelineCancel}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
