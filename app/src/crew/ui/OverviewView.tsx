// 「總覽」畫面（#134）：專案卡片、篩選列與四欄的工作看板。資料整理在 overview.ts，這裡只負責呈現；本畫面只讀。
// 點專案卡片＝篩選成該專案；點工作 → 「工作與驗收」選中那一件（待交件的工作沒有交件，改切到「交辦」）。
// 手機（窄螢幕）時看板改成依狀態切換的清單（分段按鈕），不橫向捲動。不呈現績效：不排名員工、不比較產量。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { WORK_STATUSES, type WorkStatus } from "../work/status";
import { DueTag, EmployeeName, employeeOptionText, PriorityTag } from "./components";
import { workTypeLabel } from "./labels";
import {
  boardColumns,
  columnLimit,
  filterItems,
  isFiltered,
  NO_FILTER,
  overviewOptions,
  readOverview,
  type Overview,
  type OverviewFilter,
  type OverviewItem,
  type ProjectSummary,
} from "./overview";
import type { CrewScreenProps, CrewTarget } from "./sections";
import "./OverviewView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: Overview };

const STATUS_KEY = {
  notSubmitted: "statusNotSubmitted",
  awaiting: "statusAwaiting",
  revising: "statusRevising",
  done: "statusDone",
} as const satisfies Record<WorkStatus, string>;

export function OverviewView({ db, identity, language, navigate }: CrewScreenProps) {
  const t = crewStrings("overview", language);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 篩選、展開與手機的狀態切換只存在元件 state，不寫瀏覽器儲存
  const [filter, setFilter] = useState<OverviewFilter>(NO_FILTER);
  const [expanded, setExpanded] = useState<ReadonlySet<WorkStatus>>(new Set());
  const [mobileStatus, setMobileStatus] = useState<WorkStatus>("awaiting");

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    readOverview(db, identity, language, clientConfig.access).then(
      (data) => current && setState({ kind: "ready", data }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language]);

  const items = state.kind === "ready" ? state.data.items : [];
  const options = useMemo(() => overviewOptions(items), [items]);
  const header = (
    <div className="crew-overview__header">
      <p className="muted crew-overview__lead">{t.lead}</p>
    </div>
  );
  if (state.kind !== "ready" || items.length === 0) {
    let body: ReactNode;
    if (state.kind === "loading") body = <p className="muted">{t.loading}</p>;
    else if (state.kind === "failed") body = <p className="error" role="alert">{t.loadFailed}</p>;
    else {
      body = (
        <section className="empty-state">
          <p className="empty-state__title">{t.empty}</p>
          <p className="empty-state__reason">{t.emptyReason}</p>
        </section>
      );
    }
    return (
      <div className="crew-overview">
        {header}
        {body}
      </div>
    );
  }

  const { projects } = state.data;
  const columns = boardColumns(filterItems(items, filter));
  const shownCount = WORK_STATUSES.reduce((n, s) => n + columns[s].length, 0);
  const update = (patch: Partial<OverviewFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const open = (item: OverviewItem) => {
    const target: CrewTarget = item.status === "notSubmitted" ? { section: "assignments" } : { section: "works", assignmentId: item.id };
    navigate?.(target);
  };
  const project = projects.find((p) => p.id === filter.projectId);
  const employee = options.employees.find((e) => e.id === filter.employeeId);
  const active: ReactNode[] = [
    ...(filter.projectId === null ? [] : [project?.label ?? filter.projectId]),
    ...(filter.employeeId === null ? [] : [<EmployeeName key="employee" name={employee?.displayName ?? filter.employeeId} language={language} />]),
    ...(filter.workTypeId === null ? [] : [workTypeLabel(filter.workTypeId, language)]),
    ...(filter.attentionOnly ? [t.filterAttention] : []),
  ];

  return (
    <div className="crew-overview">
      {header}
      <section className="crew-overview__projects" aria-label={t.projectsLabel}>
        <p className="visually-hidden">{t.projectSelectHint}</p>
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            selected={filter.projectId === p.id}
            onSelect={() => update({ projectId: filter.projectId === p.id ? null : p.id })}
            t={t}
            language={language}
          />
        ))}
      </section>

      <div className="crew-overview__filters">
        <label className="crew-overview__filter">
          <span className="muted">{t.filterProject}</span>
          <select value={filter.projectId ?? ""} onChange={(e) => update({ projectId: e.target.value === "" ? null : e.target.value })}>
            <option value="">{t.filterAll}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-overview__filter">
          <span className="muted">{t.filterEmployee}</span>
          <select value={filter.employeeId ?? ""} onChange={(e) => update({ employeeId: e.target.value === "" ? null : e.target.value })}>
            <option value="">{t.filterAll}</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeOptionText(e.displayName, language)}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-overview__filter">
          <span className="muted">{t.filterWorkType}</span>
          <select value={filter.workTypeId ?? ""} onChange={(e) => update({ workTypeId: e.target.value === "" ? null : e.target.value })}>
            <option value="">{t.filterAll}</option>
            {options.workTypes.map((w) => (
              <option key={w} value={w}>
                {workTypeLabel(w, language)}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-overview__check">
          <input type="checkbox" checked={filter.attentionOnly} onChange={(e) => update({ attentionOnly: e.target.checked })} />
          <span>{t.filterAttention}</span>
        </label>
      </div>
      {isFiltered(filter) && (
        <div className="crew-overview__active">
          <p className="crew-overview__active-text">
            <span className="muted">{t.activeFilter}</span>
            {active.map((item, i) => (
              <span key={i} className="badge crew-overview__active-item">
                {item}
              </span>
            ))}
          </p>
          <button type="button" className="secondary" onClick={() => setFilter(NO_FILTER)}>
            {t.clearFilter}
          </button>
        </div>
      )}

      <section className="crew-overview__board" aria-label={t.boardLabel}>
        {/* 手機：依狀態切換的分段按鈕（桌機隱藏，四欄並排） */}
        <div className="crew-overview__picker" role="group" aria-label={t.statusPicker}>
          {WORK_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={mobileStatus === s} onClick={() => setMobileStatus(s)}>
              {t[STATUS_KEY[s]]}
              <span className="crew-overview__picker-count">{columns[s].length}</span>
            </button>
          ))}
        </div>
        {shownCount === 0 && (
          <section className="empty-state">
            <p className="empty-state__title">{t.emptyFiltered}</p>
          </section>
        )}
        <div className="crew-overview__columns" hidden={shownCount === 0}>
          {WORK_STATUSES.map((s) => {
            const all = columns[s];
            const limit = columnLimit(s);
            const showAll = expanded.has(s);
            const shown = showAll ? all : all.slice(0, limit);
            const headingId = `crew-overview-column-${s}`;
            return (
              <section key={s} className="crew-overview__column" data-status={s} data-current={mobileStatus === s || undefined} aria-labelledby={headingId}>
                <h2 id={headingId} className="crew-overview__column-title">
                  {t[STATUS_KEY[s]]}
                  <span className="muted crew-overview__column-count">{fill(t.columnCount, { count: all.length }, language)}</span>
                </h2>
                {all.length === 0 ? (
                  <p className="muted crew-overview__column-empty">{t.columnEmpty}</p>
                ) : (
                  <ul className="crew-overview__cards">
                    {shown.map((item) => (
                      <li key={item.id}>
                        <WorkCard item={item} onOpen={() => open(item)} t={t} language={language} />
                      </li>
                    ))}
                  </ul>
                )}
                {all.length > limit && (
                  <button
                    type="button"
                    className="secondary crew-overview__more"
                    aria-expanded={showAll}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (showAll) next.delete(s);
                        else next.add(s);
                        return next;
                      })
                    }
                  >
                    {showAll ? t.showLess : fill(t.showAll, { count: all.length }, language)}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface ProjectCardProps {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
  t: CrewTexts<"overview">;
  language: LanguageCode;
}

function ProjectCard({ project: p, selected, onSelect, t, language }: ProjectCardProps) {
  const done = p.counts.done;
  const percent = p.total === 0 ? 0 : Math.round((done / p.total) * 100);
  const flags = [
    { key: "overdue", text: fill(t.flagOverdue, { count: p.attention.overdue }, language), count: p.attention.overdue },
    { key: "soon", text: fill(t.flagSoon, { count: p.attention.soon }, language), count: p.attention.soon },
    { key: "stalled", text: fill(t.flagStalled, { count: p.attention.stalled }, language), count: p.attention.stalled },
  ];
  return (
    <button type="button" className="crew-overview__project" aria-pressed={selected} onClick={onSelect}>
      <span className="crew-overview__project-name">{p.label}</span>
      <span className="muted crew-overview__project-sources">{fill(t.projectSources, { sources: p.sources.join(t.separator) }, language)}</span>
      <span className="crew-overview__progress-text">{fill(t.projectProgress, { done, total: p.total }, language)}</span>
      <span className="crew-overview__progress" aria-hidden="true">
        <span className="crew-overview__progress-bar" style={{ width: `${percent}%` }} />
      </span>
      <span className="crew-overview__counts">
        {WORK_STATUSES.map((s) => (
          <span key={s} className="crew-overview__count" data-status={s}>
            {fill(t.statusCount, { status: t[STATUS_KEY[s]], count: p.counts[s] }, language)}
          </span>
        ))}
      </span>
      <span className="crew-overview__flags">
        {flags.map((f) => (
          <span key={f.key} className="crew-overview__flag" data-flag={f.key} data-zero={f.count === 0 || undefined}>
            {f.text}
          </span>
        ))}
      </span>
      <span className="muted crew-overview__knowledge">{fill(t.projectKnowledge, { count: p.knowledge }, language)}</span>
      {/* 現在生效的守則（#153 第 7 點）；0 條也顯示 */}
      <span className="muted crew-overview__knowledge crew-overview__guidelines">{fill(t.projectGuidelines, { count: p.guidelines }, language)}</span>
    </button>
  );
}

interface WorkCardProps {
  item: OverviewItem;
  onOpen: () => void;
  t: CrewTexts<"overview">;
  language: LanguageCode;
}

function WorkCard({ item, onOpen, t, language }: WorkCardProps) {
  return (
    <button type="button" className="crew-overview__work" data-status={item.status} onClick={onOpen}>
      <span className="crew-overview__work-title">{item.title}</span>
      <span className="crew-overview__work-meta">
        <EmployeeName name={item.employee.displayName} language={language} />
        <span className="muted">{workTypeLabel(item.workTypeId, language)}</span>
      </span>
      <span className="crew-overview__work-tags">
        <PriorityTag priority={item.priority} language={language} />
        <DueTag due={item.due} language={language} />
        {item.flags.stalled && <span className="badge crew-overview__stalled">{t.stalled}</span>}
        {item.checkFailed && <span className="crew-overview__check-failed">{t.checkFailed}</span>}
        {item.status === "revising" && item.round !== null && (
          <span className="crew-overview__round">{fill(t.revisingRound, { round: item.round }, language)}</span>
        )}
      </span>
      {item.stayDays !== null && <span className="muted crew-overview__stay">{fill(t.stayDays, { count: item.stayDays }, language)}</span>}
      {item.status === "notSubmitted" && <span className="muted crew-overview__hint">{t.notSubmittedHint}</span>}
    </button>
  );
}
