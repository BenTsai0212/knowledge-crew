// crew 頁（#34）：頁首（標題與「虛構資料」標示）、子導覽與目前位置的畫面。
// H～K 掛上畫面時：新增 <畫面>View.tsx／.css，在 SCREENS 插入一行 import 與一行登錄。
// 子導覽的「工作與驗收」「信任」帶數字（#103，只給能驗收的身分）；目前的子頁捲進按鈕列（手機是可橫向滑動的按鈕列）。
import { useEffect, useRef, useState } from "react";
import { fill } from "../../client/i18n";
import { crewStrings } from "../i18n";
import { useCrewToday } from "./HomeToday";
import { scrollDelta, sectionCounts } from "./section-counts";
import { CREW_SECTIONS, DEFAULT_CREW_SECTION, type CrewScreen, type CrewScreenProps, type CrewSection, type CrewTarget } from "./sections";
import { AssignView } from "./AssignView";
import { EmployeesView } from "./EmployeesView";
import { LedgerView } from "./LedgerView";
import { OverviewView } from "./OverviewView";
import { ReviewView } from "./ReviewView";
import { TrustView } from "./TrustView";
import "./CrewPage.css";

const SCREENS: Partial<Record<CrewSection, CrewScreen>> = {
  overview: OverviewView,
  employees: EmployeesView,
  assignments: AssignView,
  works: ReviewView,
  trust: TrustView,
  ledger: LedgerView,
};

interface Props extends Omit<CrewScreenProps, "navigate" | "employeeId" | "assignmentId" | "ledgerFilter"> {
  /** 從 crew 頁之外切到某個位置（原文的「來自 AI 員工 ○○」#92、首頁的今天的工作 #96）；n 每次要求都不同，同一個位置也重新切換 */
  request?: { target: CrewTarget; n: number } | null;
}

// 帳本的篩選不同時重新掛上畫面（#121），一開始的篩選才會套用
const filterKey = (f: CrewTarget["ledgerFilter"]) => (f ? `${f.employeeId ?? ""}/${f.workTypeId ?? ""}/${f.event ?? "all"}` : "");

export function CrewPage({ request = null, ...props }: Props) {
  const t = crewStrings("common", props.language);
  // 目前位置（與交辦頁預選的員工）只存在元件 state，不寫瀏覽器儲存
  const [target, setTarget] = useState<CrewTarget>(() => request?.target ?? { section: DEFAULT_CREW_SECTION });
  useEffect(() => {
    if (request !== null) setTarget(request.target);
  }, [request?.n]);
  const { section } = target;
  const Screen = SCREENS[section];
  // 子導覽的數字：切換子頁與畫面寫入後重新讀取（寫入後也照舊通知 App 更新首頁與側欄）
  const [version, setVersion] = useState(0);
  const today = useCrewToday(props.db, props.identity, props.language, true, `${section}/${version}`);
  const counts = today?.identity === props.identity && today.data !== "failed" ? sectionCounts(today.data) : {};
  const onChanged = () => {
    setVersion((v) => v + 1);
    props.onChanged?.();
  };
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const delta = scrollDelta(nav.getBoundingClientRect(), current.getBoundingClientRect());
    if (delta !== 0) nav.scrollLeft += delta;
  }, [section]);
  return (
    <section className="crew-page">
      <header className="crew-page__header">
        <h1 className="crew-page__title">{t.title}</h1>
        <span className="badge" title={t.fictionalDataNote}>
          {t.fictionalData}
        </span>
      </header>
      <nav ref={navRef} className="crew-page__sections" aria-label={t.sectionsLabel}>
        {CREW_SECTIONS.map((s) => {
          const count = counts[s.id];
          const countId = `crew-section-count-${s.id}`;
          return (
            <button
              key={s.id}
              type="button"
              className="crew-page__section"
              aria-current={s.id === section ? "page" : undefined}
              aria-describedby={count === undefined ? undefined : countId}
              onClick={() => setTarget({ section: s.id })}
            >
              {t[s.label]}
              {count !== undefined && (
                <>
                  <span className="crew-page__count" aria-hidden="true">
                    {count}
                  </span>
                  {/* 數字的說明放在 aria-describedby，按鈕的名稱仍是子頁的名稱 */}
                  <span id={countId} hidden>
                    {fill(s.id === "works" ? t.sectionWorksCount : t.sectionTrustCount, { count }, props.language)}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </nav>
      {Screen ? (
        <Screen
          key={`${section}/${target.employeeId ?? ""}/${target.assignmentId ?? ""}/${filterKey(target.ledgerFilter)}`}
          {...props}
          onChanged={onChanged}
          navigate={setTarget}
          employeeId={target.employeeId}
          assignmentId={target.assignmentId}
          ledgerFilter={target.ledgerFilter}
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
