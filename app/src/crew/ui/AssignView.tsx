// 「交辦」畫面（#38）：交辦表單、交辦清單與「模擬交件」。資料整理與寫入在 assign.ts，這裡只負責呈現；
// 表單與按鈕只給能驗收的身分（RLS 的寫入條件也是 can_review）。寫入後一律重新讀取，畫面與資料庫一致。
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { DEMO } from "../demo/load";
import { crewStrings, type CrewTexts } from "../i18n";
import { readAssign, simulateAssignment, submitAssignment, type AssignData, type AssignItem, type AssignStatus } from "./assign";
import { workTypeLabel } from "./labels";
import type { CrewScreenProps } from "./sections";
import { canReviewOf, type TodayEmployee } from "./today";
import "./AssignView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: AssignData };

const STATUS_KEY: Record<AssignStatus, "statusNotSubmitted" | "statusAwaitingReview" | "statusReturned" | "statusAccepted"> = {
  notSubmitted: "statusNotSubmitted",
  awaitingReview: "statusAwaitingReview",
  returned: "statusReturned",
  accepted: "statusAccepted",
};

export function AssignView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("assign", language);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

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
        <AssignForm data={data} t={t} language={language} onSubmit={(input) => submitAssignment(db, identity, input).then(reload)} />
      ) : (
        <p className="muted">{t.readOnlyNote}</p>
      )}
      <section className="card crew-assign__block" aria-labelledby="crew-assign-list">
        <h3 id="crew-assign-list">{t.listTitle}</h3>
        <p className="muted">
          {data.assignments.length === 0 ? t.listEmpty : fill(t.listCount, { count: data.assignments.length }, language)}
        </p>
        {data.assignments.length > 0 && (
          <ul className="crew-assign__list">
            {data.assignments.map((a) => (
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
      </section>
    </div>
  );
}

function employeeLabel(e: TodayEmployee, t: CrewTexts<"assign">): string {
  return e.roleNote === null ? e.displayName : fill(t.employeeOption, { employee: e.displayName, roleNote: e.roleNote });
}

interface FormInput {
  repoId: string;
  title: string;
  workTypeId: string;
  employeeId: string;
}

function AssignForm({
  data,
  t,
  language,
  onSubmit,
}: {
  data: AssignData;
  t: CrewTexts<"assign">;
  language: LanguageCode;
  onSubmit: (input: FormInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [repoId, setRepoId] = useState(data.repos[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? "");
  const [workTypeId, setWorkTypeId] = useState(data.workTypes[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const blank = title.trim() === "";
  const ready = !blank && repoId !== "" && employeeId !== "" && workTypeId !== "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    onSubmit({ repoId, title, workTypeId, employeeId }).then(
      () => {
        setBusy(false);
        setTitle("");
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <form className="card crew-assign__block crew-assign__form" aria-labelledby="crew-assign-form" onSubmit={submit}>
      <h3 id="crew-assign-form">{t.formTitle}</h3>
      <label className="crew-assign__field crew-assign__field--wide">
        <span>{t.fieldTitle}</span>
        <input
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
      </label>
      <label className="crew-assign__field">
        <span>{t.fieldRepo}</span>
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          {data.repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
            </option>
          ))}
        </select>
      </label>
      <label className="crew-assign__field">
        <span>{t.fieldEmployee}</span>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {employeeLabel(e, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="crew-assign__field">
        <span>{t.fieldWorkType}</span>
        <select value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)}>
          {data.workTypes.map((w) => (
            <option key={w} value={w}>
              {workTypeLabel(w, language)}
            </option>
          ))}
        </select>
      </label>
      <div className="crew-assign__actions">
        <button type="submit" disabled={!ready || busy}>
          {busy ? t.submitting : t.submit}
        </button>
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
      <span className="crew-assign__item-head">
        <span className="crew-assign__item-title">{item.title}</span>
        <span className="badge">{t[STATUS_KEY[item.status]]}</span>
      </span>
      <span className="crew-assign__item-meta muted">
        <span className="crew-assign__ref">{fill(t.assignmentRef, { repo: item.repoFullName, issue: item.issueNumber })}</span>
        <span>{employeeLabel(item.employee, t)}</span>
        <span>{workTypeLabel(item.workTypeId, language)}</span>
      </span>
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
