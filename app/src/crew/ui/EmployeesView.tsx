// 「員工」畫面（#37）：看得到的員工（名稱、說明）與每類工作的目前層級、驗收次數。
// 資料整理在 employees.ts，這裡只負責呈現；只讀，沒有按鈕。
import { useEffect, useState } from "react";
import { fill } from "../../client/i18n";
import { crewStrings } from "../i18n";
import { readEmployees, type EmployeeSummary } from "./employees";
import { workTypeLabel } from "./labels";
import type { CrewScreenProps } from "./sections";
import "./EmployeesView.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; employees: EmployeeSummary[] };

export function EmployeesView({ db, identity, language }: CrewScreenProps) {
  const t = crewStrings("employees", language);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    readEmployees(db, identity, language).then(
      (employees) => current && setState({ kind: "ready", employees }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language]);

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  if (state.employees.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return (
    <div className="crew-employees">
      {state.employees.map((e) => (
        <section key={e.id} className="card crew-employees__card" aria-labelledby={`crew-employee-${e.id}`}>
          <h3 id={`crew-employee-${e.id}`}>{e.displayName}</h3>
          {e.roleNote !== null && <p className="muted">{e.roleNote}</p>}
          {e.workTypes.length === 0 ? (
            <p className="muted">{t.noWorkTypes}</p>
          ) : (
            <table className="crew-employees__table">
              <thead>
                <tr>
                  <th scope="col">{t.columnWorkType}</th>
                  <th scope="col">{t.columnLevel}</th>
                  <th scope="col">{t.columnReviews}</th>
                </tr>
              </thead>
              <tbody>
                {e.workTypes.map((w) => (
                  <tr key={w.workTypeId}>
                    <th scope="row">{workTypeLabel(w.workTypeId, language)}</th>
                    <td>
                      <span className="badge" data-level={w.level}>
                        {w.level === "light" ? t.levelLight : t.levelItem}
                      </span>
                    </td>
                    <td>{fill(t.reviewCount, { count: w.reviewCount }, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
