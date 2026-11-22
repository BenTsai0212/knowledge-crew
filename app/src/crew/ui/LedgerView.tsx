// 「工作帳本」畫面（#40；#77 依設計規格 v3 第 6.7 節改成表格）：交辦、交件、驗收、同意少看與收回、因做錯了改回逐項看，
// 依時間新到舊列出，可依員工與事件篩選。資料整理在 ledger.ts，這裡只負責呈現；本畫面只讀，沒有寫入按鈕。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { crewStrings, type CrewTexts } from "../i18n";
import type { ReturnReason } from "../trust/types";
import { EmployeeName, employeeOptionText, withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import {
  actorName,
  filterLedger,
  LEDGER_PAGE_SIZE,
  ledgerOptions,
  ledgerTone,
  readLedger,
  type LedgerEvent,
  type LedgerEventFilter,
  type LedgerKind,
} from "./ledger";
import type { CrewScreenProps } from "./sections";
import "./LedgerView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; events: LedgerEvent[] };

const REASON_KEYS: Record<ReturnReason, "reasonWrong" | "reasonDifferentApproach" | "reasonProcess"> = {
  wrong: "reasonWrong",
  different_approach: "reasonDifferentApproach",
  process: "reasonProcess",
};

// 層級改變前的符號（設計稿：→ 同意少看、↺ 因做錯了改回逐項看）；只是裝飾，螢幕閱讀器不讀
const KIND_SYMBOL: Partial<Record<LedgerKind, string>> = { relax: "→", autoReset: "↺" };

const EVENT_FILTERS: { value: LedgerEventFilter; key: "filterAll" | "eventLevel" | "eventReturned" }[] = [
  { value: "all", key: "filterAll" },
  { value: "level", key: "eventLevel" },
  { value: "returned", key: "eventReturned" },
];

function kindText(event: LedgerEvent, t: CrewTexts<"ledger">, language: LanguageCode): string {
  switch (event.kind) {
    case "assigned":
      return t.kindAssigned;
    case "submitted":
      return fill(t.kindSubmitted, { round: event.round ?? 1 }, language);
    case "accepted":
      // 第 1 輪只寫「驗收通過」，之後的輪次寫出來（設計稿）
      return event.round !== null && event.round > 1 ? fill(t.kindAcceptedRound, { round: event.round }, language) : t.kindAccepted;
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
  // 篩選與顯示筆數只存在元件 state，不寫瀏覽器儲存
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<LedgerEventFilter>("all");
  const [limit, setLimit] = useState(LEDGER_PAGE_SIZE);

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setEmployeeId(null);
    setEventFilter("all");
    setLimit(LEDGER_PAGE_SIZE);
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
  const day = useMemo(() => new Intl.DateTimeFormat(language, { month: "2-digit", day: "2-digit" }), [language]);
  const full = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }), [language]);

  const header = (
    <div className="crew-ledger__header">
      <h2 className="crew-ledger__title">{t.title}</h2>
      <p className="muted crew-ledger__lead">{t.lead}</p>
    </div>
  );
  let body: ReactNode;
  if (state.kind === "loading") body = <p className="muted">{t.loading}</p>;
  else if (state.kind === "failed") body = <p className="error" role="alert">{t.loadFailed}</p>;
  else if (events.length === 0) {
    body = (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  if (body !== undefined) {
    return (
      <div className="crew-ledger">
        {header}
        {body}
      </div>
    );
  }

  const filtered = filterLedger(events, { employeeId, event: eventFilter });
  const shown = filtered.slice(0, limit);
  const changeFilter = (apply: () => void) => {
    apply();
    setLimit(LEDGER_PAGE_SIZE);
  };
  const actorCell = (e: LedgerEvent): ReactNode => {
    const actor = actorName(clientConfig.access, options.employees, e.actor, language);
    if (actor === null) return t.actorRule;
    return options.employees.some((x) => x.id === e.actor) ? <EmployeeName name={actor} language={language} /> : actor;
  };
  return (
    <div className="crew-ledger">
      <div className="crew-ledger__top">
        {header}
        <label className="crew-ledger__filter">
          <span className="muted">{t.filterEmployee}</span>
          <select value={employeeId ?? ""} onChange={(e) => changeFilter(() => setEmployeeId(e.target.value === "" ? null : e.target.value))}>
            <option value="">{t.filterAll}</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeOptionText(e.displayName, language)}
              </option>
            ))}
          </select>
        </label>
        <label className="crew-ledger__filter">
          <span className="muted">{t.filterEvent}</span>
          <select value={eventFilter} onChange={(e) => changeFilter(() => setEventFilter(e.target.value as LedgerEventFilter))}>
            {EVENT_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {t[f.key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <section className="empty-state">
          <p className="empty-state__title">{t.emptyFiltered}</p>
        </section>
      ) : (
        <section className="card crew-ledger__card">
          {/* 窄螢幕時表格在框內橫向捲動；框可以用鍵盤聚焦後捲動 */}
          <div className="crew-ledger__scroll" role="region" aria-label={t.scrollLabel} tabIndex={0}>
            <table className="crew-ledger__table" aria-label={t.listLabel}>
              <thead>
                <tr>
                  <th scope="col">{t.columnDate}</th>
                  <th scope="col">{t.columnEvent}</th>
                  <th scope="col">{t.columnWork}</th>
                  <th scope="col">{t.columnEmployee}</th>
                  <th scope="col">{t.columnActor}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const tone = ledgerTone(e);
                  const symbol = KIND_SYMBOL[e.kind];
                  return (
                    <tr key={e.id} data-kind={e.kind} data-tone={tone ?? undefined}>
                      <td className="crew-ledger__date">
                        <time dateTime={e.at} title={full.format(new Date(e.at))}>
                          {day.format(new Date(e.at))}
                        </time>
                      </td>
                      <td>
                        <span className="crew-ledger__kind">
                          {symbol && <span aria-hidden="true">{symbol}</span>}
                          <span>{kindText(e, t, language)}</span>
                        </span>
                      </td>
                      {/* 層級改變是員工 × 工作類型的事，不屬於某一件工作（設計稿寫 —） */}
                      <td>{e.assignment && tone !== "level" ? e.assignment.title : <span className="muted">{t.noAssignment}</span>}</td>
                      <td>{withEmployee(t.eventMeta, { workType: workTypeLabel(e.workTypeId, language) }, e.employee.displayName, language)}</td>
                      <td className="muted">{actorCell(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > shown.length && (
            <div className="crew-ledger__more">
              <button type="button" className="secondary" onClick={() => setLimit((n) => n + LEDGER_PAGE_SIZE)}>
                {t.loadMore}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
