// 「員工」畫面（#37；#83 改為員工卡，設計規格 v3 第 6.5 節）：每位員工一張卡（職務圖示、AI 標記＋名字、職務・工作、
// 層級徽章；交件、工作來源、驗收次數與待驗收件數、最近的圓點；一句說明；「看信任紀錄」「交辦給 ○○」）。
// 資料整理在 employees.ts，這裡只負責呈現；「交辦給 ○○」只給能驗收的身分（與交辦頁的表單一致）。
// #145 加上「守則」區塊（EmployeeGuidelines.tsx）：決定只給能驗收的身分，decideGuideline() 後重新讀取；從首頁點進來時捲到該員工卡。
import { useEffect, useRef, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { decideGuideline, type NewGuidelineDecision } from "../db/store";
import { crewStrings, type CrewTexts } from "../i18n";
import { DotRow, EmployeeName, LevelBadge, withEmployee } from "./components";
import { EmployeeGuidelineSection } from "./EmployeeGuidelines";
import { readEmployees, type EmployeeNote, type EmployeeSummary, type EmployeeWorkType } from "./employees";
import { workTypeLabel } from "./labels";
import { deliverableName, deliverableOf, type Deliverable } from "./review/conclusion";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import { isSameDay, shortDate } from "./trust";
import "./EmployeesView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; employees: EmployeeSummary[] };
type T = CrewTexts<"employees">;

export function EmployeesView({ db, identity, language, navigate, employeeId, onChanged }: CrewScreenProps) {
  const t = crewStrings("employees", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 寫入守則的決定（#145）：寫入中、寫入失敗的員工卡；寫入後（成功或失敗）以 version 重新讀取，不閃讀取中
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const scrollPending = useRef(employeeId !== undefined);

  useEffect(() => {
    let current = true;
    if (version === 0) setState({ kind: "loading" });
    readEmployees(db, identity, language, canReview).then(
      (employees) => current && setState({ kind: "ready", employees }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language, canReview, version]);

  // 從首頁的「等你決定」點進來（#145）：讀取完成後把該員工卡捲進畫面
  useEffect(() => {
    if (state.kind !== "ready" || !scrollPending.current) return;
    scrollPending.current = false;
    document.getElementById(`crew-employee-${employeeId}`)?.closest("section")?.scrollIntoView?.({ block: "start" });
  }, [state, employeeId]);

  const decide = async (employee: string, input: NewGuidelineDecision) => {
    setSaving(true);
    setFailed(null);
    try {
      await decideGuideline(db, identity, input);
      onChanged?.();
    } catch {
      setFailed(employee);
    }
    setVersion((v) => v + 1);
    setSaving(false);
  };

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  if (state.employees.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  const now = new Date();
  return (
    <div className="crew-employees">
      <header className="crew-employees__header">
        <p className="crew-employees__count">{fill(t.title, { count: state.employees.length }, language)}</p>
        <p className="muted">{t.intro}</p>
      </header>
      <div className="crew-employees__grid">
        {state.employees.map((e) => {
          const main = e.workTypes[0] ?? null;
          return (
            <section key={e.id} className="card crew-employees__card" aria-labelledby={`crew-employee-${e.id}`}>
              <div className="crew-employees__top">
                <RoleIcon deliverable={main && deliverableOf(main.workTypeId)} />
                <div className="crew-employees__identity">
                  <h2 id={`crew-employee-${e.id}`}>
                    <EmployeeName name={e.displayName} language={language} />
                  </h2>
                  {(e.roleNote !== null || main) && (
                    <p className="muted">
                      {e.roleNote !== null && main
                        ? fill(t.role, { role: e.roleNote, workType: workTypeLabel(main.workTypeId, language) })
                        : (e.roleNote ?? workTypeLabel(main!.workTypeId, language))}
                    </p>
                  )}
                </div>
                {e.workTypes.length === 1 && <LevelBadge level={main!.level}>{levelText(main!, t)}</LevelBadge>}
              </div>
              {e.workTypes.length === 0 && <p className="muted">{t.noWorkTypes}</p>}
              {e.workTypes.map((w) => (
                <WorkFacts key={w.workTypeId} work={w} heading={e.workTypes.length > 1} t={t} language={language} now={now} />
              ))}
              <EmployeeGuidelineSection
                employee={e}
                guidelines={e.guidelines}
                canReview={canReview}
                saving={saving}
                failed={failed === e.id}
                language={language}
                decide={(input) => void decide(e.id, input)}
                openReturn={navigate && ((assignmentId) => navigate({ section: "works", assignmentId }))}
              />
              <div className="crew-employees__links">
                <button type="button" className="link" onClick={() => navigate?.({ section: "trust" })}>
                  {t.linkTrust}
                </button>
                {canReview && main && (
                  <button type="button" className="link" onClick={() => navigate?.({ section: "assignments", employeeId: e.id })}>
                    {withEmployee(t.linkAssign, {}, e.displayName, language)}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const levelText = (w: EmployeeWorkType, t: T) => (w.level === "light" ? t.levelLight : t.levelItem);

const NOTE_TEXT = { relax: "noteRelax", revoke: "noteRevoke", reset: "noteReset" } as const satisfies Record<string, keyof T>;

function noteText(note: EmployeeNote, t: T, language: LanguageCode, now: Date): string {
  if (note.kind === "suggestion") return t.noteSuggestion;
  const { kind, at } = note.event;
  const date = isSameDay(at, now) ? crewStrings("trust", language).today : shortDate(at, language);
  return fill(t[NOTE_TEXT[kind]], { date });
}

function WorkFacts({ work, heading, t, language, now }: { work: EmployeeWorkType; heading: boolean; t: T; language: LanguageCode; now: Date }) {
  return (
    <div className="crew-employees__work">
      {heading && (
        <h3>
          {workTypeLabel(work.workTypeId, language)} <LevelBadge level={work.level}>{levelText(work, t)}</LevelBadge>
        </h3>
      )}
      <dl className="crew-employees__facts">
        <dt>{t.fieldDeliverable}</dt>
        <dd>{deliverableName(deliverableOf(work.workTypeId), language)}</dd>
        <dt>{t.fieldSource}</dt>
        <dd className={work.source?.kind === "repo" ? "crew-employees__mono" : undefined}>{work.source?.label ?? t.noSource}</dd>
        <dt>{t.fieldReviews}</dt>
        <dd>{fill(t.reviewsValue, { reviews: fill(t.reviewCount, { count: work.reviewCount }, language), count: work.awaiting }, language)}</dd>
        <dt>{fill(t.fieldRecent, { count: work.dots.length }, language)}</dt>
        <dd>{work.dots.length === 0 ? <span className="muted">{t.noDots}</span> : <DotRow dots={work.dots} corrected={work.dotCorrections} language={language} />}</dd>
      </dl>
      {work.note !== null && (
        <p className="crew-employees__note" data-kind={work.note.kind}>
          {noteText(work.note, t, language, now)}
        </p>
      )}
    </div>
  );
}

// 職務圖示（設計規格 v3 第 4 節）：依工作類型的交件種類。客服＝信封、內容＝喇叭、文件＝書、開發＝程式符號，其他是通用的公事包
const ROLE_ICON: Record<Deliverable | "other", string[]> = {
  reply: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 7l9 6 9-6"],
  post: ["M4 10v4h3l6 4V6L7 10H4z", "M16 9.5a3.5 3.5 0 0 1 0 5", "M18.5 7a7 7 0 0 1 0 10"],
  kb: ["M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z", "M5 17a3 3 0 0 1 3-3h10", "M9 8h5"],
  code: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M13.5 5l-3 14"],
  other: ["M4 8h16v11H4z", "M9 8V5h6v3", "M4 13h16"],
};

function RoleIcon({ deliverable }: { deliverable: Deliverable | null }) {
  return (
    <span className="crew-employees__icon" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" focusable="false">
        {ROLE_ICON[deliverable ?? "other"].map((d) => (
          <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}
