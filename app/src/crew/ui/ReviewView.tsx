// 「工作與驗收」畫面（#39）：左側是工作清單（窄螢幕在面板之下，#50），選一筆後顯示驗收面板。
// 資料整理在 review.ts；面板只依 reviewFocus() 的結果呈現。「通過」「退回」只給能驗收的身分，寫入後重新讀取。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { createReview } from "../db/store";
import type { ReturnReason } from "../trust/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { CheckRow, LevelBadge, withEmployee } from "./components";
import { isCodePosition, positionLabel } from "./glossary";
import { workTypeLabel } from "./labels";
import { initialSelection, readReviewPanel, readWorkList, type ReviewPanel, type WorkList, type WorkListItem } from "./review";
import { assignmentRef, workRef } from "./refs";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import "./ReviewView.css";

type Texts = CrewTexts<"review">;
type Data = { list: WorkList; selected: string | null; panel: ReviewPanel | null };
type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: Data };

const REASON_TEXT = {
  wrong: "reasonWrong",
  different_approach: "reasonDifferentApproach",
  process: "reasonProcess",
} as const satisfies Record<ReturnReason, keyof Texts>;
const REASONS = Object.keys(REASON_TEXT) as ReturnReason[];

export function ReviewView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("review", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // 目前的選取只存在元件 state；重新讀取時保留（還看得到時），否則選待驗收的第一筆
  const selectedRef = useRef<string | null>(null);
  // 在清單選了一筆之後把面板捲進畫面（窄螢幕面板在清單之上；已在畫面上時不捲動）
  const panelRef = useRef<HTMLElement>(null);
  const scrollPending = useRef(false);

  const load = useCallback(
    async (want: string | null): Promise<Data> => {
      const list = await readWorkList(db, identity, language);
      const visible = want !== null && [...list.awaiting, ...list.recent].some((i) => i.id === want);
      const selected = visible ? want : initialSelection(list);
      const panel = selected === null ? null : await readReviewPanel(db, identity, language, selected, canReview);
      selectedRef.current = selected;
      return { list, selected, panel };
    },
    [db, identity, language, canReview],
  );

  const refresh = useCallback(
    async (want: string | null) => {
      try {
        setState({ kind: "ready", data: await load(want) });
      } catch {
        setState({ kind: "failed" });
      }
    },
    [load],
  );

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setSaveFailed(false);
    load(selectedRef.current).then(
      (data) => current && setState({ kind: "ready", data }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [load]);

  const select = (id: string) => {
    setSaveFailed(false);
    scrollPending.current = true;
    void refresh(id);
  };

  useEffect(() => {
    if (state.kind !== "ready" || !scrollPending.current) return;
    scrollPending.current = false;
    const panel = panelRef.current;
    if (panel && !topInView(panel)) panel.scrollIntoView?.({ block: "start" });
  }, [state]);

  const decide = async (input: Parameters<typeof createReview>[2]) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await createReview(db, identity, input);
    } catch {
      setSaveFailed(true);
    }
    // 成功或失敗都重新讀取，畫面與資料庫一致
    await refresh(selectedRef.current);
    setSaving(false);
  };

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { list, selected, panel } = state.data;
  if (list.awaiting.length === 0 && list.recent.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return (
    <div className="crew-review">
      <nav className="card crew-review__list" aria-label={t.listLabel}>
        <ListGroup title={t.awaiting} count={t.awaitingCount} empty={t.awaitingEmpty} items={list.awaiting} {...{ selected, select, t, language }} />
        <ListGroup title={t.recent} count={t.recentCount} empty={t.recentEmpty} items={list.recent} {...{ selected, select, t, language }} />
      </nav>
      {panel ? (
        <Panel key={panel.current.id} anchor={panelRef} panel={panel} t={t} language={language} saving={saving} saveFailed={saveFailed} decide={decide} />
      ) : (
        <p className="muted crew-review__hint">{t.selectHint}</p>
      )}
    </div>
  );
}

interface ListGroupProps {
  title: string;
  count: string;
  empty: string;
  items: WorkListItem[];
  selected: string | null;
  select: (id: string) => void;
  t: Texts;
  language: LanguageCode;
}

function ListGroup({ title, count, empty, items, selected, select, t, language }: ListGroupProps) {
  return (
    <section className="crew-review__group">
      <h3>
        {title} <span className="muted">{fill(count, { count: items.length }, language)}</span>
      </h3>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="crew-review__items">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="crew-review__item"
                aria-current={item.id === selected ? "true" : undefined}
                onClick={() => select(item.id)}
              >
                <span className="crew-review__item-title">{item.title}</span>
                <span className="muted crew-review__ref">{itemRef(item, t, language)}</span>
                <span className="muted">{itemMeta(item, t, language)}</span>
                {item.verdict && (
                  <span className="badge" data-verdict={item.verdict}>
                    {item.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 面板的頂端是否在畫面上、且不被 sticky 的頂端列蓋住（scroll-margin-top 是頂端列讓出的高度，#50）
function topInView(element: HTMLElement): boolean {
  const top = element.getBoundingClientRect().top;
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
  return top >= margin && top < window.innerHeight;
}

function itemRef(item: WorkListItem, t: Texts, language: LanguageCode): string {
  const assignment = assignmentRef(item, language);
  const work = workRef(item.sourceKind, item.workRef, language);
  return work === null ? assignment : fill(t.itemRef, { assignment, work });
}
const itemMeta = (item: WorkListItem, t: Texts, language: LanguageCode) =>
  withEmployee(t.itemMeta, { workType: workTypeLabel(item.workTypeId, language), round: item.round }, item.employee.displayName, language);

interface PanelProps {
  anchor: RefObject<HTMLElement | null>;
  panel: ReviewPanel;
  t: Texts;
  language: LanguageCode;
  saving: boolean;
  saveFailed: boolean;
  decide: (input: Parameters<typeof createReview>[2]) => Promise<void>;
}

function Panel({ anchor, panel, t, language, saving, saveFailed, decide }: PanelProps) {
  const { item, focus, current, earlier } = panel;
  // 退回的表單只存在元件 state；換一筆工作時（key 改變）重設
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  return (
    <article ref={anchor} className="card crew-review__panel" aria-labelledby="crew-review-title">
      <header className="crew-review__head">
        <h3 id="crew-review-title">{item.title}</h3>
        <p className="muted crew-review__ref">{itemRef(item, t, language)}</p>
        <p className="muted">{itemMeta(item, t, language)}</p>
        <p className="crew-review__level">
          <span className="muted">{t.levelLabel}</span>
          <LevelBadge level={focus.level}>{focus.level === "light" ? t.levelLight : t.levelItem}</LevelBadge>
        </p>
      </header>

      <section className="crew-review__section">
        <h4>{t.points}</h4>
        {focus.noPoints ? (
          <p className="crew-review__notice" role="note">{t.noPoints}</p>
        ) : (
          <ul>
            {focus.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="crew-review__section">
        <h4>{t.checks}</h4>
        {focus.checks.length === 0 ? (
          <p className="muted">{t.checksEmpty}</p>
        ) : (
          <ul className="crew-review__checks">
            {focus.checks.map((c) => (
              <li key={c.name}>
                <CheckRow name={c.name} status={c.status} language={language} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crew-review__section">
        <h4>{t.changes}</h4>
        {focus.changes.mode === "items" ? (
          <ul className="crew-review__changes">
            {focus.changes.items.map((c, i) => (
              <li key={i}>
                <span className={isCodePosition(c.path) ? "crew-review__ref" : undefined}>{positionLabel(c.path, language)}</span>
                <span>{c.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{fill(t.changesSummary, { count: focus.changes.count }, language)}</p>
        )}
      </section>

      <details className="crew-review__details">
        <summary>{t.body}</summary>
        <p className="crew-review__body">{focus.body.text}</p>
      </details>

      {earlier.length > 0 && (
        <section className="crew-review__section">
          <h4>{t.earlier}</h4>
          {earlier.map((w) => (
            <details key={w.round} className="crew-review__details">
              <summary>{earlierRound(w.round, workRef(item.sourceKind, w.externalRef, language), t)}</summary>
              <p>{w.summary}</p>
              <p className="muted">{fill(t.submittedAt, { date: formatDate(w.submittedAt, language) })}</p>
              {w.review === null ? (
                <p className="muted">{t.earlierPending}</p>
              ) : (
                <p>
                  <span className="badge" data-verdict={w.review.verdict}>
                    {w.review.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
                  </span>{" "}
                  {w.review.reason && t[REASON_TEXT[w.review.reason]]}
                  {w.review.note && <span className="muted crew-review__note">{w.review.note}</span>}
                </p>
              )}
            </details>
          ))}
        </section>
      )}

      {panel.canDecide && (
        <section className="crew-review__actions">
          {!returning ? (
            <div className="crew-review__buttons">
              <button type="button" disabled={saving} onClick={() => decide({ workId: current.id, verdict: "accepted" })}>
                {saving ? t.saving : t.accept}
              </button>
              <button type="button" className="secondary" disabled={saving} onClick={() => setReturning(true)}>
                {t.return}
              </button>
            </div>
          ) : (
            <fieldset className="crew-review__return" disabled={saving}>
              <legend>{t.returnReason}</legend>
              {REASONS.map((r) => (
                <label key={r} className="crew-review__reason">
                  <input type="radio" name="crew-review-reason" checked={reason === r} onChange={() => setReason(r)} />
                  {t[REASON_TEXT[r]]}
                </label>
              ))}
              <label className="crew-review__note-field">
                {t.note}
                <textarea value={note} placeholder={t.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="crew-review__buttons">
                <button
                  type="button"
                  disabled={reason === null}
                  onClick={() =>
                    reason &&
                    decide({ workId: current.id, verdict: "returned", reason, ...(trimmed === "" ? {} : { note: trimmed }) })
                  }
                >
                  {saving ? t.saving : t.confirmReturn}
                </button>
                <button type="button" className="secondary" onClick={() => setReturning(false)}>
                  {t.cancel}
                </button>
              </div>
            </fieldset>
          )}
        </section>
      )}
      {saveFailed && (
        <p className="error" role="alert">
          {t.saveFailed}
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string, language: LanguageCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

const earlierRound = (round: number, work: string | null, t: Texts) =>
  work === null ? fill(t.earlierRoundNoRef, { round }) : fill(t.earlierRound, { round, work });
