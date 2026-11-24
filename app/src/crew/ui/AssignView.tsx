// 「交辦」畫面（#38；#76 改成設計規格 v3 第 6.6 節）：交辦表單（員工單選卡、依員工帶入來源與工作類型、結果說明）、
// 交辦清單（最近 4 件，可看全部）與「模擬交件」。資料整理與寫入在 assign.ts，這裡只負責呈現；
// 表單與按鈕只給能驗收的身分（RLS 的寫入條件也是 can_review）。寫入後一律重新讀取，畫面與資料庫一致。
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { PRIORITIES, type Priority } from "../db/store";
import { DEMO } from "../demo/load";
import { crewStrings, type CrewTexts } from "../i18n";
import {
  initialChoice,
  readAssign,
  resultKey,
  RECENT_COUNT,
  simulateAssignment,
  submitAssignment,
  visibleAssignments,
  type AssignData,
  type AssignEmployee,
  type AssignItem,
  type AssignStatus,
} from "./assign";
import { EmployeeName, LevelBadge, ScheduleLine, withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import { assignmentRef } from "./refs";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import "./AssignView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: AssignData };

const STATUS_KEY: Record<AssignStatus, "statusNotSubmitted" | "statusAwaitingReview" | "statusReturned" | "statusAccepted"> = {
  notSubmitted: "statusNotSubmitted",
  awaitingReview: "statusAwaitingReview",
  returned: "statusReturned",
  accepted: "statusAccepted",
};

export function AssignView({ db, identity, language, employeeId, onChanged }: CrewScreenProps) {
  const t = crewStrings("assign", language);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  // 交辦與模擬交件會改變首頁與側欄的件數（#96）
  const reload = useCallback(() => (setVersion((v) => v + 1), onChanged?.()), [onChanged]);
  const [showAll, setShowAll] = useState(false);

  // 第一次讀取時才顯示「讀取中」；寫入後的重新讀取保留目前的畫面
  useEffect(() => {
    setState({ kind: "loading" });
  }, [db, identity, language]);

  useEffect(() => {
    let current = true;
    readAssign(db, identity, language, canReviewOf(clientConfig.access, identity)).then(
      (data) => current && setState({ kind: "ready", data }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language, version]);

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { data } = state;
  if (!data.canReview && data.assignments.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return (
    <div className="crew-assign">
      {data.canReview ? (
        <AssignForm data={data} t={t} language={language} preselect={employeeId} onSubmit={(input) => submitAssignment(db, identity, input).then(reload)} />
      ) : (
        <p className="muted">{t.readOnlyNote}</p>
      )}
      <section className="card crew-assign__block" aria-labelledby="crew-assign-list">
        <div className="crew-assign__list-head">
          <h3 id="crew-assign-list">{t.listTitle}</h3>
          <span className="muted crew-assign__hint">
            {data.assignments.length === 0
              ? t.listEmpty
              : showAll || data.assignments.length <= RECENT_COUNT
                ? fill(t.listCount, { count: data.assignments.length }, language)
                : fill(t.listRecent, { count: RECENT_COUNT }, language)}
          </span>
        </div>
        {data.assignments.length > 0 && (
          <ul className="crew-assign__list">
            {visibleAssignments(data.assignments, showAll).map((a) => (
              <AssignRow
                key={a.id}
                item={a}
                t={t}
                language={language}
                onSimulate={() => (DEMO ? simulateAssignment(db, identity, a.id, DEMO, language).then(reload) : Promise.reject(new Error("no demo")))}
              />
            ))}
          </ul>
        )}
        {data.assignments.length > RECENT_COUNT && (
          <button type="button" className="crew-assign__more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? fill(t.listShowRecent, { count: RECENT_COUNT }, language) : fill(t.listShowAll, { count: data.assignments.length }, language)}
          </button>
        )}
      </section>
    </div>
  );
}

const employeeLabel = (e: AssignEmployee | AssignItem["employee"], t: CrewTexts<"assign">, language: LanguageCode) =>
  withEmployee(e.roleNote === null ? "{employee}" : t.employeeOption, e.roleNote === null ? {} : { roleNote: e.roleNote }, e.displayName, language);

function formatDay(iso: string, language: LanguageCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(date);
}

interface FormInput {
  sourceId: string;
  title: string;
  workTypeId: string;
  employeeId: string;
  /** 沒有填時是 null（#133） */
  dueAt: string | null;
  priority: Priority;
}

const PRIORITY_KEY = { high: "priorityHigh", normal: "priorityNormal", low: "priorityLow" } as const satisfies Record<Priority, string>;

function AssignForm({
  data,
  t,
  language,
  preselect,
  onSubmit,
}: {
  data: AssignData;
  t: CrewTexts<"assign">;
  language: LanguageCode;
  /** 預選的員工（員工卡的「交辦給 ○○」） */
  preselect: string | undefined;
  onSubmit: (input: FormInput) => Promise<void>;
}) {
  const [initial] = useState(() => initialChoice(data, preselect));
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [employeeId, setEmployeeId] = useState(initial.employeeId);
  // 到期日與優先順序（#133）：選填，沒填時與之前相同（沒有到期日、一般）
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const employee = data.employees.find((e) => e.id === employeeId) ?? null;
  const workTypeId = employee?.workTypeId ?? "";
  const blank = title.trim() === "";
  const ready = !blank && sourceId !== "" && employee !== null && workTypeId !== "";
  const levelText = (e: AssignEmployee) => (e.level === "light" ? t.levelLight : t.levelItem);

  // 選了員工就帶入他平常的來源（看不到時保留目前的選擇）
  const choose = (e: AssignEmployee) => {
    setEmployeeId(e.id);
    if (e.usualSourceId !== null) setSourceId(e.usualSourceId);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    onSubmit({ sourceId, title, workTypeId, employeeId, dueAt: dueAt === "" ? null : dueAt, priority }).then(
      () => {
        setBusy(false);
        setTitle("");
        setDueAt("");
        setPriority("normal");
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  const sourceHint =
    employee === null
      ? t.sourcePickEmployee
      : employee.usualSourceId !== null && employee.usualSourceId !== sourceId
        ? t.sourceChanged
        : t.sourceUsual;

  return (
    <form className="card crew-assign__block crew-assign__form" aria-labelledby="crew-assign-form" onSubmit={submit}>
      <h3 id="crew-assign-form">{t.formTitle}</h3>
      <div className="crew-assign__field">
        <label htmlFor="crew-assign-title" className="crew-assign__label">
          {t.fieldTitle}
        </label>
        <input
          id="crew-assign-title"
          type="text"
          value={title}
          placeholder={t.fieldTitlePlaceholder}
          aria-describedby={blank ? "crew-assign-title-required" : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        {blank && (
          <span id="crew-assign-title-required" className="muted crew-assign__hint">
            {t.titleRequired}
          </span>
        )}
      </div>
      <fieldset className="crew-assign__employees">
        <legend className="crew-assign__label">{t.fieldEmployee}</legend>
        <div className="crew-assign__cards">
          {data.employees.map((e) => (
            <label key={e.id} className="crew-assign__card" data-selected={e.id === employeeId || undefined}>
              <input type="radio" name="crew-assign-employee" value={e.id} checked={e.id === employeeId} onChange={() => choose(e)} />
              <span className="crew-assign__card-text">
                <strong>{employeeLabel(e, t, language)}</strong>
                <span className="muted crew-assign__hint">
                  {fill(t.employeeCardMeta, { workType: e.workTypeId === null ? "—" : workTypeLabel(e.workTypeId, language), level: levelText(e) })}
                </span>
              </span>
            </label>
          ))}
        </div>
        {employee === null && <span className="muted crew-assign__hint">{t.employeeRequired}</span>}
      </fieldset>
      <div className="crew-assign__pair">
        <div className="crew-assign__field">
          <label htmlFor="crew-assign-source" className="crew-assign__label">
            {t.fieldSource}
          </label>
          <select id="crew-assign-source" value={sourceId} aria-describedby="crew-assign-source-hint" onChange={(e) => setSourceId(e.target.value)}>
            {data.sources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <span id="crew-assign-source-hint" className="muted crew-assign__hint">
            {employee === null ? sourceHint : withEmployee(sourceHint, {}, employee.displayName, language)}
          </span>
        </div>
        <div className="crew-assign__field">
          <label htmlFor="crew-assign-work-type" className="crew-assign__label">
            {t.fieldWorkType}
          </label>
          <input
            id="crew-assign-work-type"
            className="crew-assign__readonly"
            type="text"
            readOnly
            value={workTypeId === "" ? "" : workTypeLabel(workTypeId, language)}
            placeholder={t.workTypePending}
            aria-describedby="crew-assign-work-type-hint"
          />
          <span id="crew-assign-work-type-hint" className="muted crew-assign__hint">
            {t.workTypeNote}
          </span>
        </div>
      </div>
      <div className="crew-assign__pair">
        <div className="crew-assign__field">
          <label htmlFor="crew-assign-due" className="crew-assign__label">
            {t.fieldDue}
          </label>
          <input id="crew-assign-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <div className="crew-assign__field">
          <label htmlFor="crew-assign-priority" className="crew-assign__label">
            {t.fieldPriority}
          </label>
          <select id="crew-assign-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t[PRIORITY_KEY[p]]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {employee !== null && workTypeId !== "" && (
        <p className="crew-assign__result" role="status">
          <strong>{withEmployee(t[resultKey(workTypeId)], {}, employee.displayName, language)}</strong>
          {t.resultRest}
          <LevelBadge level={employee.level}>{levelText(employee)}</LevelBadge>
          {t.resultEnd}
        </p>
      )}
      <div className="crew-assign__actions">
        <button type="submit" disabled={!ready || busy}>
          {busy ? t.submitting : t.submit}
        </button>
        <span className="muted crew-assign__hint">{t.demoNote}</span>
        {failed && (
          <p className="error" role="alert">
            {t.writeFailed}
          </p>
        )}
      </div>
    </form>
  );
}

function AssignRow({
  item,
  t,
  language,
  onSimulate,
}: {
  item: AssignItem;
  t: CrewTexts<"assign">;
  language: LanguageCode;
  onSimulate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const simulate = () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    onSimulate().then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };
  return (
    <li className="crew-assign__item">
      <span className="crew-assign__item-title">{item.title}</span>
      <span className="crew-assign__item-meta muted">
        <span>
          <EmployeeName name={item.employee.displayName} language={language} />
          {t.metaSeparator}
          {fill(t.assignedOn, { date: formatDay(item.assignedAt, language) })}
        </span>
        <span className="crew-assign__ref">{assignmentRef(item, language)}</span>
        <span>{workTypeLabel(item.workTypeId, language)}</span>
      </span>
      <ScheduleLine item={item} language={language} />
      <span className="badge crew-assign__status">{t[STATUS_KEY[item.status]]}</span>
      {item.simulate === "available" && (
        <span className="crew-assign__item-actions">
          <button type="button" disabled={busy} onClick={simulate}>
            {busy ? t.simulating : t.simulate}
          </button>
        </span>
      )}
      {item.simulate === "noReply" && <span className="muted crew-assign__hint">{t.simulateNoReply}</span>}
      {failed && (
        <span className="error" role="alert">
          {t.writeFailed}
        </span>
      )}
    </li>
  );
}
