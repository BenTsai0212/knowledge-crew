// 「今天」畫面（#34）：待驗收、進行中、建議少看。資料整理在 today.ts，這裡只負責呈現；
// 「虛構資料」標示在 CrewPage 的頁首（每個位置都顯示）。
import { useEffect, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { workTypeLabel } from "./labels";
import { assignmentRef } from "./refs";
import type { CrewScreenProps } from "./sections";
import { canReviewOf, isAllEmpty, readToday, type Today, type TodayAssignment } from "./today";
import "./TodayView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; today: Today };

export function TodayView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("today", language);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    readToday(db, identity, language, canReviewOf(clientConfig.access, identity)).then(
      (today) => current && setState({ kind: "ready", today }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language]);

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { today } = state;
  if (isAllEmpty(today)) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.allEmpty}</p>
      </section>
    );
  }
  const count = (template: string, n: number) => fill(template, { count: n }, language);
  return (
    <div className="crew-today">
      <section className="card crew-today__block" aria-labelledby="crew-today-awaiting">
        <h3 id="crew-today-awaiting">{t.awaitingReview}</h3>
        <p className="muted">
          {today.awaitingReview.length === 0
            ? today.canReview ? t.awaitingReviewEmpty : t.awaitingReviewEmptyOthers
            : count(today.canReview ? t.awaitingReviewCount : t.awaitingReviewCountOthers, today.awaitingReview.length)}
        </p>
        <AssignmentList items={today.awaitingReview} t={t} language={language} />
      </section>
      <section className="card crew-today__block" aria-labelledby="crew-today-progress">
        <h3 id="crew-today-progress">{t.inProgress}</h3>
        <p className="muted">
          {today.inProgress.length === 0 ? t.inProgressEmpty : count(t.inProgressCount, today.inProgress.length)}
        </p>
        <AssignmentList items={today.inProgress} t={t} language={language} />
      </section>
      {today.canReview && (
        <section className="card crew-today__block" aria-labelledby="crew-today-relax">
          <h3 id="crew-today-relax">{t.relaxSuggested}</h3>
          {today.suggestions.length === 0 ? (
            <p className="muted">{t.relaxSuggestedEmpty}</p>
          ) : (
            <ul className="crew-today__list">
              {today.suggestions.map((s) => (
                <li key={`${s.employee.id}/${s.workTypeId}`} className="crew-today__item">
                  {fill(
                    t.relaxSuggestedItem,
                    { employee: s.employee.displayName, workType: workTypeLabel(s.workTypeId, language), count: s.count },
                    language,
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function AssignmentList({ items, t, language }: { items: TodayAssignment[]; t: CrewTexts<"today">; language: LanguageCode }) {
  if (items.length === 0) return null;
  return (
    <ul className="crew-today__list">
      {items.map((a) => {
        const workType = workTypeLabel(a.workTypeId, language);
        const meta =
          a.employee.roleNote === null
            ? fill(t.assignmentMetaNoRole, { employee: a.employee.displayName, workType })
            : fill(t.assignmentMeta, { employee: a.employee.displayName, roleNote: a.employee.roleNote, workType });
        return (
          <li key={a.id} className="crew-today__item">
            <span className="crew-today__item-title">{a.title}</span>
            <span className="crew-today__item-meta muted">
              <span className="crew-today__ref">{assignmentRef(a, language)}</span>
              <span>{meta}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
