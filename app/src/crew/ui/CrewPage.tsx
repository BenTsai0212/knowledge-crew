// crew 頁（#34）：頁首（#179：小字「AI 員工」＋子頁主標題 h1＋分頁；「虛構資料」只在外框，#182）與目前位置的畫面。
// H～K 掛上畫面時：新增 <畫面>View.tsx／.css，在 SCREENS 插入一行 import 與一行登錄。
// 子導覽的「工作」「員工」帶數字（#103、#145、#191，只給能驗收的身分）；分頁元件是共用的 Tabs（nav），目前的子頁捲到中間。
import { useEffect, useState } from "react";
import { fill } from "../../client/i18n";
import { crewStrings } from "../i18n";
import { useCrewToday } from "./HomeToday";
import { PageHeader } from "../../ui/PageHeader";
import { Tabs } from "../../ui/Tabs";
import { sectionCounts } from "./section-counts";
import { CREW_SECTIONS, DEFAULT_CREW_SECTION, resolveCrewTarget, type CrewScreen, type CrewScreenProps, type CrewSection, type CrewTarget } from "./sections";
import { AssignView } from "./AssignView";
import { EmployeesView } from "./EmployeesView";
import { RecordsView } from "./RecordsView";
import { WorksView } from "./WorksView";
import "./CrewPage.css";

const SCREENS: Partial<Record<CrewSection, CrewScreen>> = {
  works: WorksView,
  employees: EmployeesView,
  assignments: AssignView,
  records: RecordsView,
};

interface Props extends Omit<CrewScreenProps, "navigate" | "employeeId" | "assignmentId" | "ledgerFilter" | "view"> {
  /** 從 crew 頁之外切到某個位置（原文的「來自 AI 員工 ○○」#92、首頁的今天的工作 #96）；n 每次要求都不同，同一個位置也重新切換 */
  request?: { target: CrewTarget; n: number } | null;
}

// 子導覽數字的說明（#191：「員工」是等你決定的件數）
const COUNT_TEXT = { employees: "sectionEmployeesCount", works: "sectionWorksCount" } as const;

// 帳本的篩選不同時重新掛上畫面（#121），一開始的篩選才會套用
const filterKey = (f: CrewTarget["ledgerFilter"]) => (f ? `${f.employeeId ?? ""}/${f.workTypeId ?? ""}/${f.event ?? "all"}` : "");

export function CrewPage({ request = null, ...props }: Props) {
  const t = crewStrings("common", props.language);
  // 目前位置（與交辦頁預選的員工）只存在元件 state，不寫瀏覽器儲存
  // 收到的位置一律經 resolveCrewTarget()：舊的 id（#191 之前的六個位置）對應到新位置
  const [target, setRawTarget] = useState<CrewTarget>(() => resolveCrewTarget(request?.target ?? { section: DEFAULT_CREW_SECTION }));
  const setTarget = (to: CrewTarget) => setRawTarget(resolveCrewTarget(to));
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
  const current = CREW_SECTIONS.find((s) => s.id === section)!;
  const items = CREW_SECTIONS.map((s) => {
    const count = counts[s.id];
    const text = COUNT_TEXT[s.id as keyof typeof COUNT_TEXT];
    // 數字的說明放在 aria-describedby，按鈕的名稱仍是子頁的名稱；子導覽的數字都是需要你處理的數
    return { id: s.id, label: t[s.label], count, you: true, countText: count === undefined ? undefined : fill(t[text], { count }, props.language) };
  });
  return (
    <section className="crew-page">
      <PageHeader
        eyebrow={t.title}
        title={t[current.label]}
        focusKey={section}
        tabs={<Tabs kind="nav" label={t.sectionsLabel} items={items} current={section} onSelect={(id) => setTarget({ section: id })} idPrefix="crew-section" />}
      />
      {Screen ? (
        <Screen
          key={`${section}/${target.view ?? ""}/${target.employeeId ?? ""}/${target.assignmentId ?? ""}/${filterKey(target.ledgerFilter)}`}
          {...props}
          onChanged={onChanged}
          navigate={setTarget}
          employeeId={target.employeeId}
          assignmentId={target.assignmentId}
          ledgerFilter={target.ledgerFilter}
          view={target.view}
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
