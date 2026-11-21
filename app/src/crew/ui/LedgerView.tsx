// 「工作帳本」畫面（#40）：交辦、交件、驗收、同意少看與收回、因做錯了改回逐項看，依時間新到舊列出，可依員工與工作類型篩選。
// 資料整理在 ledger.ts，這裡只負責呈現；本畫面只讀，沒有寫入按鈕。
import { useEffect, useMemo, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { crewStrings, type CrewTexts } from "../i18n";
import type { ReturnReason } from "../trust/types";
import { workTypeLabel } from "./labels";
import { actorName, filterLedger, ledgerOptions, readLedger, type LedgerEvent } from "./ledger";
import type { CrewScreenProps } from "./sections";
import "./LedgerView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; events: LedgerEvent[] };

const REASON_KEYS: Record<ReturnReason, "reasonWrong" | "reasonDifferentApproach" | "reasonProcess"> = {
  wrong: "reasonWrong",
  different_approach: "reasonDifferentApproach",
  process: "reasonProcess",
};

function kindText(event: LedgerEvent, t: CrewTexts<"ledger">, language: LanguageCode): string {
  switch (event.kind) {
    case "assigned":
      return t.kindAssigned;
    case "submitted":
      return fill(t.kindSubmitted, { round: event.round ?? 1 }, language);
    case "accepted":
      return t.kindAccepted;
    case "returned":
      // 退回一定有原因（crew.reviews 的 CHECK）
      return fill(t.kindReturned, { reason: event.reason === null ? "" : t[REASON_KEYS[event.reason]] }, language);
    case "relax":
      return t.kindRelax;
    case "revoke":
      return t.kindRevoke;
    case "autoReset":
      return t.kindAutoReset;
  }
}

export function LedgerView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("ledger", language);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 篩選只存在元件 state，不寫瀏覽器儲存
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [workTypeId, setWorkTypeId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setEmployeeId(null);
    setWorkTypeId(null);
    readLedger(db, identity, language).then(
      (events) => current && setState({ kind: "ready", events }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language]);

  const events = state.kind === "ready" ? state.events : [];
  const options = useMemo(() => ledgerOptions(events), [events]);
  const time = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }), [language]);

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  if (events.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  const shown = filterLedger(events, { employeeId, workTypeId });
  return (
    <div className="crew-ledger">
      <div className="crew-ledger__filters">
        <label>
          {t.filterEmployee}
          <select value={employeeId ?? ""} onChange={(e) => setEmployeeId(e.target.value === "" ? null : e.target.value)}>
            <option value="">{t.filterAll}</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.filterWorkType}
          <select value={workTypeId ?? ""} onChange={(e) => setWorkTypeId(e.target.value === "" ? null : e.target.value)}>
            <option value="">{t.filterAll}</option>
            {options.workTypeIds.map((id) => (
              <option key={id} value={id}>
                {workTypeLabel(id, language)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <section className="empty-state">
          <p className="empty-state__title">{t.emptyFiltered}</p>
        </section>
      ) : (
        <ol className="card crew-ledger__list" aria-label={t.listLabel}>
          {shown.map((e) => {
            const actor = actorName(clientConfig.access, options.employees, e.actor, language);
            return (
              <li key={e.id} className="crew-ledger__item" data-kind={e.kind}>
                <span className="crew-ledger__head">
                  <time className="crew-ledger__time muted" dateTime={e.at}>
                    {time.format(new Date(e.at))}
                  </time>
                  <span className="badge">{kindText(e, t, language)}</span>
                </span>
                {e.assignment && <span className="crew-ledger__item-title">{e.assignment.title}</span>}
                <span className="crew-ledger__meta muted">
                  {e.assignment && (
                    <span className="crew-ledger__ref">
                      {fill(t.assignmentRef, { repo: e.assignment.repoFullName, issue: e.assignment.issueNumber })}
                    </span>
                  )}
                  <span>{fill(t.eventMeta, { employee: e.employee.displayName, workType: workTypeLabel(e.workTypeId, language) })}</span>
                  <span>{actor === null ? t.actorRule : fill(t.byActor, { name: actor })}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
