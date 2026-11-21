// 「信任」畫面（#37）：每個看得到的「員工 × 工作類型」的最近圓點、目前層級、最近一次改回逐項看，
// 以及建議少看與「同意少看」「收回」。資料整理與寫入在 trust.ts；按鈕只給能驗收的身分，寫入後重新讀取。
import { useCallback, useEffect, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import type { Dot } from "../trust/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { workTypeLabel } from "./labels";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import { agreeRelax, readTrust, revokeRelax, type Trust, type TrustRow } from "./trust";
import "./TrustView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; trust: Trust };

const rowKey = (r: TrustRow) => `${r.employee.id}/${r.workTypeId}`;

export function TrustView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("trust", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 寫入中的組合與寫入失敗的組合（只存在元件 state）
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(
    () => readTrust(db, identity, language, canReview),
    [db, identity, language, canReview],
  );

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setFailed(null);
    load().then(
      (trust) => current && setState({ kind: "ready", trust }),
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
    } catch {
      setFailed(key);
    }
    // 成功或失敗都重新讀取，畫面與資料庫一致
    try {
      setState({ kind: "ready", trust: await load() });
    } catch {
      setState({ kind: "failed" });
    } finally {
      setSaving(null);
    }
  };

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { trust } = state;
  if (trust.rows.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return (
    <div className="crew-trust">
      {trust.rows.map((row) => {
        const key = rowKey(row);
        const busy = saving !== null;
        const suggestion = trust.canReview ? row.suggestion : null;
        return (
          <section key={key} className="card crew-trust__row" aria-labelledby={`crew-trust-${key}`}>
            <h3 id={`crew-trust-${key}`}>
              {fill(t.rowTitle, { employee: row.employee.displayName, workType: workTypeLabel(row.workTypeId, language) })}
            </h3>
            <Dots dots={row.dots} t={t} language={language} />
            <p className="crew-trust__level">
              <span className="muted">{t.levelLabel}</span>
              <span className="badge" data-level={row.level}>
                {row.level === "light" ? t.levelLight : t.levelItem}
              </span>
            </p>
            {row.lastReset !== null && <p className="muted">{fill(t.lastReset, { date: formatDate(row.lastReset, language) })}</p>}
            {suggestion && <p>{fill(t.suggestion, { count: suggestion.count }, language)}</p>}
            {trust.canReview && (suggestion || row.level === "light") && (
              <div className="crew-trust__actions">
                {suggestion && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => write(row, () => agreeRelax(db, identity, { ...row, suggestion }))}
                  >
                    {saving === key ? t.saving : t.agreeRelax}
                  </button>
                )}
                {row.level === "light" && (
                  <button type="button" className="secondary" disabled={busy} onClick={() => write(row, () => revokeRelax(db, identity, row))}>
                    {saving === key ? t.saving : t.revoke}
                  </button>
                )}
              </div>
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

const DOT_TEXT = { ok: "dotOk", wrong: "dotWrong", neutral: "dotNeutral" } as const satisfies Record<Dot, keyof CrewTexts<"trust">>;
const DOT_MARK: Record<Dot, string> = { ok: "●", wrong: "×", neutral: "○" };

function Dots({ dots, t, language }: { dots: Dot[]; t: CrewTexts<"trust">; language: LanguageCode }) {
  if (dots.length === 0) return <p className="muted">{t.dotsNone}</p>;
  const count = (d: Dot) => dots.filter((x) => x === d).length;
  return (
    <div className="crew-trust__dots-block">
      <ol className="crew-trust__dots" aria-label={fill(t.dotsLabel, { count: dots.length }, language)}>
        {dots.map((d, i) => (
          <li key={i} className="crew-trust__dot" data-dot={d} title={t[DOT_TEXT[d]]} aria-label={t[DOT_TEXT[d]]}>
            <span aria-hidden="true">{DOT_MARK[d]}</span>
          </li>
        ))}
      </ol>
      <p className="muted crew-trust__summary">
        {fill(t.dotsSummary, { ok: count("ok"), wrong: count("wrong"), neutral: count("neutral") })}
      </p>
    </div>
  );
}

function formatDate(iso: string, language: LanguageCode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
