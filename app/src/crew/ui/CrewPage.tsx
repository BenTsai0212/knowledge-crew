// crew 頁（#34）：頁首（標題與「虛構資料」標示）、子導覽與目前位置的畫面。
// H～K 掛上畫面時：新增 <畫面>View.tsx／.css，在 SCREENS 插入一行 import 與一行登錄。
import { useEffect, useState } from "react";
import { crewStrings } from "../i18n";
import { CREW_SECTIONS, type CrewScreen, type CrewScreenProps, type CrewSection, type CrewTarget } from "./sections";
import { AssignView } from "./AssignView";
import { EmployeesView } from "./EmployeesView";
import { LedgerView } from "./LedgerView";
import { ReviewView } from "./ReviewView";
import { TodayView } from "./TodayView";
import { TrustView } from "./TrustView";
import "./CrewPage.css";

const SCREENS: Partial<Record<CrewSection, CrewScreen>> = {
  today: TodayView,
  employees: EmployeesView,
  assignments: AssignView,
  works: ReviewView,
  trust: TrustView,
  ledger: LedgerView,
};

interface Props extends Omit<CrewScreenProps, "navigate" | "employeeId" | "assignmentId"> {
  /** 從 crew 頁之外切到某個位置（原文的「來自 AI 員工 ○○」#92、首頁的今天的工作 #96）；n 每次要求都不同，同一個位置也重新切換 */
  request?: { target: CrewTarget; n: number } | null;
}

export function CrewPage({ request = null, ...props }: Props) {
  const t = crewStrings("common", props.language);
  // 目前位置（與交辦頁預選的員工）只存在元件 state，不寫瀏覽器儲存
  const [target, setTarget] = useState<CrewTarget>(() => request?.target ?? { section: "today" });
  useEffect(() => {
    if (request !== null) setTarget(request.target);
  }, [request?.n]);
  const { section } = target;
  const Screen = SCREENS[section];
  return (
    <section className="crew-page">
      <header className="crew-page__header">
        <h1 className="crew-page__title">{t.title}</h1>
        <span className="badge" title={t.fictionalDataNote}>
          {t.fictionalData}
        </span>
      </header>
      <nav className="crew-page__sections" aria-label={t.sectionsLabel}>
        {CREW_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="crew-page__section"
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => setTarget({ section: s.id })}
          >
            {t[s.label]}
          </button>
        ))}
      </nav>
      {Screen ? (
        <Screen
          key={`${section}/${target.employeeId ?? ""}/${target.assignmentId ?? ""}`}
          {...props}
          navigate={setTarget}
          employeeId={target.employeeId}
          assignmentId={target.assignmentId}
        />
      ) : (
        <section className="empty-state">
          <p className="empty-state__title">{t.preparingTitle}</p>
          <p className="empty-state__reason">{t.preparingBody}</p>
        </section>
      )}
    </section>
  );
}
