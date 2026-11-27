// 「紀錄」子頁（#191，ADR 0009 第二節）：事件＝原本的「工作帳本」（LedgerView）；頁首下方的「看統計」切換成統計表＝
// 原本信任頁上方的總表（TrustReport），內容不改。目前的模式只存在元件 state（一開始依 view）；表上的數字切回事件並套用篩選。
import { useEffect, useState } from "react";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { readLedger, type LedgerFilter } from "./ledger";
import { LedgerView } from "./LedgerView";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import { readTrust } from "./trust";
import { trustReport, type TrustReportRow } from "./trust-report";
import { TrustReport } from "./TrustReport";
import "./TrustView.css";

export function RecordsView(props: CrewScreenProps) {
  const t = crewStrings("common", props.language);
  const [stats, setStats] = useState(props.view === "stats");
  return (
    <div className="crew-view crew-records">
      <div className="crew-view__switch">
        {/* 設計稿 15-records.html：一個按鈕，名稱是切過去的那一邊（「看統計」「看事件」） */}
        <button type="button" className="ui-btn ui-btn--sm" onClick={() => setStats(!stats)}>
          {stats ? t.viewEvents : t.viewStats}
        </button>
      </div>
      {stats ? <Stats {...props} openLedger={(ledgerFilter) => (setStats(false), props.navigate?.({ section: "records", ledgerFilter }))} /> : <LedgerView {...props} />}
    </div>
  );
}

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; rows: TrustReportRow[] };

function Stats({ db, identity, language, openLedger }: CrewScreenProps & { openLedger: (filter: LedgerFilter) => void }) {
  const t = crewStrings("trust", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    Promise.all([readTrust(db, identity, language, canReview), readLedger(db, identity, language)]).then(
      ([trust, events]) => current && setState({ kind: "ready", rows: trustReport(trust.rows, events) }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language, canReview]);
  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  if (state.rows.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return <TrustReport rows={state.rows} language={language} openLedger={openLedger} />;
}
