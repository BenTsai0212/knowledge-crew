// 「信任」畫面（#37；#75 改為時間軸，設計規格 v3 第 6.4 節）：每個看得到的「員工 × 工作類型」一張卡，
// 時間軸是事件、圓點與日期、當時的層級三列。資料整理與寫入在 trust.ts；按鈕只給能驗收的身分，寫入後重新讀取。
// 最上方是總覽報表（#121，TrustReport.tsx）：計數來自工作帳本的事件，點一列切到工作帳本並套用篩選。
// 少看建議的依據與「建議的經過」（#125）：同樣由工作帳本的事件整理（suggestion-history.ts）。
import { Fragment, useCallback, useEffect, useState, type CSSProperties } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { DEMO_PARAMS } from "../trust/demo-params";
import type { Dot, ReviewLevel } from "../trust/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { DotMark, dotsSummary, LevelBadge, withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import type { CrewScreenProps } from "./sections";
import { actorName, readLedger, type LedgerEvent } from "./ledger";
import { suggestionBasis, suggestionHistory, type BasisItem, type HistoryStep } from "./suggestion-history";
import { canReviewOf } from "./today";
import { TrustReport } from "./TrustReport";
import { trustReport, type TrustReportRow } from "./trust-report";
import {
  agreeRelax,
  isSameDay,
  readTrust,
  revokeRelax,
  shortDate,
  type TimelineEvent,
  type Trust,
  type TrustNote,
  type TrustRow,
  type TrustTimeline,
} from "./trust";
import "./TrustView.css";

type Loaded = { trust: Trust; report: TrustReportRow[]; events: LedgerEvent[] };
type State = { kind: "loading" } | { kind: "failed" } | ({ kind: "ready" } & Loaded);

const rowKey = (r: TrustRow) => `${r.employee.id}/${r.workTypeId}`;

export function TrustView({ db, identity, language, onChanged, navigate }: CrewScreenProps) {
  const t = crewStrings("trust", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 寫入中的組合與寫入失敗的組合（只存在元件 state）
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    const [trust, events] = await Promise.all([readTrust(db, identity, language, canReview), readLedger(db, identity, language)]);
    return { trust, report: trustReport(trust.rows, events), events };
  }, [db, identity, language, canReview]);

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setFailed(null);
    load().then(
      (loaded) => current && setState({ kind: "ready", ...loaded }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [load]);

  const write = async (row: TrustRow, action: () => Promise<unknown>) => {
    const key = rowKey(row);
    setSaving(key);
    setFailed(null);
    try {
      await action();
      // 子導覽的少看建議數與首頁的「等你決定」跟著更新（#103）
      onChanged?.();
    } catch {
      setFailed(key);
    }
    // 成功或失敗都重新讀取，畫面與資料庫一致
    try {
      setState({ kind: "ready", ...(await load()) });
    } catch {
      setState({ kind: "failed" });
    } finally {
      setSaving(null);
    }
  };

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { trust, report, events } = state;
  if (trust.rows.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  const now = new Date();
  const date = (iso: string) => (isSameDay(iso, now) ? t.today : shortDate(iso, language));
  const openLedger = (row: TrustRow) =>
    navigate && (() => navigate({ section: "ledger", ledgerFilter: { employeeId: row.employee.id, workTypeId: row.workTypeId } }));
  const openWork = navigate && ((assignmentId: string) => navigate({ section: "works", assignmentId }));
  return (
    <div className="crew-trust">
      <header className="crew-trust__header">
        <div className="crew-trust__heading">
          <h2>{t.title}</h2>
          <p className="muted">{fill(t.intro, { count: DEMO_PARAMS.dots }, language)}</p>
        </div>
        <ul className="crew-trust__legend" aria-label={t.legendLabel}>
          <li><DotMark dot="ok" className="crew-trust__dot" />{t.legendOk}</li>
          <li><DotMark dot="wrong" className="crew-trust__dot" />{t.legendWrong}</li>
          <li><DotMark dot="neutral" className="crew-trust__dot" />{t.legendNeutral}</li>
        </ul>
      </header>
      <TrustReport rows={report} language={language} openLedger={navigate && ((ledgerFilter) => navigate({ section: "ledger", ledgerFilter }))} />
      <p className="crew-trust__rules">{t.rules}</p>
      {trust.rows.map((row) => {
        const key = rowKey(row);
        const busy = saving !== null;
        const suggestion = trust.canReview ? row.suggestion : null;
        const counts = countDots(row.timeline);
        return (
          <section key={key} className="card crew-trust__row" aria-labelledby={`crew-trust-${key}`}>
            <div className="crew-trust__top">
              <h3 id={`crew-trust-${key}`}>
                {withEmployee(t.rowTitle, { workType: workTypeLabel(row.workTypeId, language) }, row.employee.displayName, language)}
              </h3>
              <span className="muted crew-trust__summary">{fill(t.dotsSummary, counts)}</span>
              <LevelBadge level={row.level}>{fill(t.levelBadge, { level: levelText(row.level, t) })}</LevelBadge>
            </div>
            <Timeline timeline={row.timeline} t={t} language={language} now={now} />
            <History
              steps={suggestionHistory(events, row.employee.id, row.workTypeId)}
              employees={trust.employees}
              {...{ t, language, date, openWork }}
            />
            <div className="crew-trust__footer">
              {row.note !== null && <p className="crew-trust__note">{noteText(row.note, row, t, language)}</p>}
              {!trust.canReview && <p className="muted crew-trust__note">{t.noteViewOnly}</p>}
              {suggestion && (
                <button type="button" disabled={busy} onClick={() => write(row, () => agreeRelax(db, identity, { ...row, suggestion }))}>
                  {saving === key ? t.saving : t.agreeRelax}
                </button>
              )}
              {trust.canReview && row.level === "light" && (
                <button type="button" className="secondary" disabled={busy} onClick={() => write(row, () => revokeRelax(db, identity, row))}>
                  {saving === key ? t.saving : t.revoke}
                </button>
              )}
            </div>
            {suggestion && (
              <Basis items={suggestionBasis(suggestion.basisReviewIds, events)} openLedger={openLedger(row)} {...{ t, language, date }} />
            )}
            {failed === key && (
              <p className="error" role="alert">
                {t.saveFailed}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

type T = CrewTexts<"trust">;

const DOT_TEXT = { ok: "dotOk", wrong: "dotWrong", neutral: "dotNeutral" } as const satisfies Record<Dot, keyof T>;
const EVENT_TEXT = { relax: "eventRelax", revoke: "eventRevoke", reset: "eventReset" } as const satisfies Record<TimelineEvent["kind"], keyof T>;

const levelText = (level: ReviewLevel, t: T) => (level === "light" ? t.levelLight : t.levelItem);

function countDots(timeline: TrustTimeline): Record<Dot, number> {
  const counts = { ok: 0, wrong: 0, neutral: 0 };
  for (const c of timeline.cells) counts[c.dot] += 1;
  return counts;
}

function noteText(note: TrustNote, row: TrustRow, t: T, language: LanguageCode): string {
  switch (note) {
    case "suggestion":
      return fill(t.noteSuggestion, { count: row.suggestion?.count ?? DEMO_PARAMS.window }, language);
    case "light":
      return t.noteLight;
    case "revoked":
      return t.noteRevoked;
    case "reset":
      return t.noteReset;
    case "tooFew":
      return fill(t.noteTooFew, { count: DEMO_PARAMS.min }, language);
  }
}

/** 層級帶：相鄰同層級的格合成一段。 */
function bands(levels: ReviewLevel[]): { level: ReviewLevel; span: number }[] {
  const out: { level: ReviewLevel; span: number }[] = [];
  for (const level of levels) {
    const last = out.at(-1);
    if (last?.level === level) last.span += 1;
    else out.push({ level, span: 1 });
  }
  return out;
}

// 事件文字至少佔幾格；靠近右端時改為向左展開（墨線在右側）
const EVENT_MIN_SPAN = 3;

function Timeline({ timeline, t, language, now }: { timeline: TrustTimeline; t: T; language: LanguageCode; now: Date }) {
  const { cells, empty, events } = timeline;
  const columns = cells.length + empty;
  if (cells.length === 0) return <p className="muted">{t.dotsNone}</p>;
  const date = (iso: string) => (isSameDay(iso, now) ? t.today : shortDate(iso, language));
  const aria = dotsSummary(cells.map((c) => c.dot), language);
  const style = { "--crew-trust-columns": columns } as CSSProperties;
  return (
    <div className="crew-trust__timeline" style={style}>
      {events.length > 0 && (
        <ol className="crew-trust__grid crew-trust__events">
          {events.map((group, i) => {
            const end = (events[i + 1]?.column ?? columns) + 1;
            const atEnd = end - (group.column + 1) < Math.min(EVENT_MIN_SPAN, columns);
            const start = atEnd ? Math.max(1, end - Math.min(EVENT_MIN_SPAN, columns)) : group.column + 1;
            const place = { "--crew-trust-start": start, "--crew-trust-end": end } as CSSProperties;
            return (
              <li key={group.column} className="crew-trust__event" data-align={atEnd ? "end" : "start"} style={place}>
                {group.items.map((e) => fill(t[EVENT_TEXT[e.kind]], { date: date(e.at) })).join(t.eventSeparator)}
              </li>
            );
          })}
        </ol>
      )}
      <ol className="crew-trust__grid crew-trust__dots" aria-label={aria}>
        {cells.map((c, i) => (
          <li key={i} className="crew-trust__cell" aria-label={fill(t.dotCell, { result: t[DOT_TEXT[c.dot]], date: date(c.at) })}>
            <DotMark dot={c.dot} className="crew-trust__dot" />
            <span className="crew-trust__date" aria-hidden="true">
              {/* 窄螢幕時在斜線後換行，不把數字拆開 */}
              {date(c.at).split("/").map((part, j) => (
                <Fragment key={j}>
                  {j > 0 && <>/<wbr /></>}
                  {part}
                </Fragment>
              ))}
            </span>
          </li>
        ))}
        {/* 不足的空格不是驗收，不算清單項目 */}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} role="none" className="crew-trust__cell" aria-hidden="true">
            <DotMark dot="none" className="crew-trust__dot" />
          </li>
        ))}
      </ol>
      <div className="crew-trust__grid crew-trust__bands">
        {bands(cells.map((c) => c.level)).map((b, i) => (
          <span key={i} className="crew-trust__band" data-level={b.level} data-span={b.span} style={{ gridColumn: `span ${b.span}` }}>
            {levelText(b.level, t)}
          </span>
        ))}
        {empty > 0 && (
          <span className="crew-trust__band" data-level="none" data-span={empty} style={{ gridColumn: `span ${empty}` }}>
            {t.bandEmpty}
          </span>
        )}
      </div>
    </div>
  );
}

const range = (items: readonly { at: string }[], date: (iso: string) => string) => ({
  from: items.length > 0 ? date(items[0].at) : "",
  to: items.length > 0 ? date(items[items.length - 1].at) : "",
});

/** 少看建議的依據（#125）：那幾次驗收的日期與工作標題，預設收起；可以切到工作帳本看這幾次。 */
function Basis({
  items,
  openLedger,
  t,
  language,
  date,
}: {
  items: BasisItem[];
  openLedger: (() => void) | undefined;
  t: T;
  language: LanguageCode;
  date: (iso: string) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="crew-trust__basis">
      <details>
        <summary>{fill(t.basisSummary, { count: items.length, ...range(items, date) }, language)}</summary>
        <ol className="crew-trust__basis-list" aria-label={t.basisLabel}>
          {items.map((item) => (
            <li key={item.reviewId}>
              <time dateTime={item.at} className="crew-trust__basis-date">{date(item.at)}</time>
              <span>{item.assignment?.title ?? t.historyUnknown}</span>
            </li>
          ))}
        </ol>
      </details>
      {openLedger && (
        <button type="button" className="secondary" onClick={openLedger}>
          {t.basisOpenLedger}
        </button>
      )}
    </div>
  );
}

/** 建議的經過（#125）：提出 → 同意 → 生效 → 收回，或因做錯了改回逐項看；沒有任何經過時不顯示。 */
function History({
  steps,
  employees,
  t,
  language,
  date,
  openWork,
}: {
  steps: HistoryStep[];
  employees: readonly { id: string; displayName: string }[];
  t: T;
  language: LanguageCode;
  date: (iso: string) => string;
  openWork: ((assignmentId: string) => void) | undefined;
}) {
  if (steps.length === 0) return null;
  const actor = (id: string | null) => actorName(clientConfig.access, employees, id, language) ?? "";
  const text = (step: HistoryStep): string => {
    const at = date(step.at);
    switch (step.kind) {
      case "proposed":
        return fill(t.historyProposed, { date: at, count: step.basis.length, ...range(step.basis, date) }, language);
      case "relax":
        return fill(t.historyRelax, { date: at, actor: actor(step.actor) });
      case "effective":
        return fill(t.historyEffective, { date: at });
      case "revoke":
        return fill(t.historyRevoke, { date: at, actor: actor(step.actor) });
      case "autoReset":
        return fill(t.historyReset, { date: at, title: step.assignment?.title ?? t.historyUnknown });
    }
  };
  return (
    <section className="crew-trust__history" aria-label={t.historyTitle}>
      <h4 className="crew-trust__history-title">{t.historyTitle}</h4>
      <ol className="crew-trust__history-list">
        {steps.map((step, i) => (
          <li key={i} data-kind={step.kind}>
            <span>{text(step)}</span>
            {step.kind === "effective" && step.assignment && openWork && (
              <button type="button" className="link crew-trust__history-open" onClick={() => openWork(step.assignment!.id)}>
                {fill(t.historyOpenWork, { title: step.assignment.title })}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
