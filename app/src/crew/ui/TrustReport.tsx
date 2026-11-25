// 信任頁的總覽報表（#121）：每個看得到的「員工 × 工作類型」一列。點一列切到工作帳本並篩選成該員工＋該工作類型，
// 點退回原因的數字再篩選成「退回」。資料整理在 trust-report.ts；手機時每列改成一張卡片（TrustView.css）。
import type { ReactNode } from "react";
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { ReturnReason } from "../trust/types";
import { crewStrings, type CrewTexts } from "../i18n";
import { DotMark, employeeOptionText, LevelBadge, withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import type { LedgerFilter } from "./ledger";
import { shortDate } from "./trust";
import { firstPassPercent, type LevelChangeKind, type TrustReportRow } from "./trust-report";

type T = CrewTexts<"trust">;

// 表頭用短名（桌機 1280 時表頭不超過兩行，#131）；完整的名稱是表頭的 title 與無障礙名稱，也是手機卡片的欄名
const REASONS: {
  reason: ReturnReason;
  key: "reportColumnWrong" | "reportColumnDifferent" | "reportColumnProcess";
  head: "reportHeadWrong" | "reportHeadDifferent" | "reportHeadProcess";
  dot: "wrong" | "neutral";
}[] = [
  { reason: "wrong", key: "reportColumnWrong", head: "reportHeadWrong", dot: "wrong" },
  { reason: "different_approach", key: "reportColumnDifferent", head: "reportHeadDifferent", dot: "neutral" },
  { reason: "process", key: "reportColumnProcess", head: "reportHeadProcess", dot: "neutral" },
];

const CHANGE_TEXT = {
  relax: "reportChangeRelax",
  revoke: "reportChangeRevoke",
  autoReset: "reportChangeAutoReset",
} as const satisfies Record<LevelChangeKind, keyof T>;

interface Props {
  rows: readonly TrustReportRow[];
  language: LanguageCode;
  /** 切到工作帳本並套用篩選；沒有時（單獨使用畫面）列不能點 */
  openLedger?: (filter: LedgerFilter) => void;
}

export function TrustReport({ rows, language, openLedger }: Props) {
  const t = crewStrings("trust", language);
  const levelText = (row: TrustReportRow) => (row.level === "light" ? t.levelLight : t.levelItem);
  return (
    <section className="card crew-trust-report" aria-labelledby="crew-trust-report-title">
      <div className="crew-trust-report__heading">
        <h3 id="crew-trust-report-title">{t.reportTitle}</h3>
        <p className="muted">{t.reportIntro}</p>
        <p className="muted crew-trust-report__note">{t.reportFirstPassNote}</p>
      </div>
      <table className="crew-trust-report__table" aria-label={t.reportLabel}>
        <thead>
          <tr>
            <th scope="col">{t.reportColumnRow}</th>
            <th scope="col" className="crew-trust-report__num">{t.reportColumnReviews}</th>
            <th scope="col" className="crew-trust-report__num" title={t.reportFirstPassNote}>
              {t.reportColumnFirstPass}
            </th>
            {REASONS.map((r) => (
              <th key={r.reason} scope="col" className="crew-trust-report__num" title={t[r.key]} aria-label={t[r.key]}>
                <span className="crew-trust-report__reason">
                  <DotMark dot={r.dot} className="crew-trust__dot" />
                  {t[r.head]}
                </span>
              </th>
            ))}
            <th scope="col">{t.reportColumnLevel}</th>
            <th scope="col">{t.reportColumnChanges}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pair = { employeeId: row.employee.id, workTypeId: row.workTypeId };
            const names = { employee: employeeOptionText(row.employee.displayName, language), workType: workTypeLabel(row.workTypeId, language) };
            const percent = firstPassPercent(row.firstPass);
            const title = withEmployee(t.reportRow, { workType: names.workType }, row.employee.displayName, language);
            return (
              <tr
                key={`${row.employee.id}/${row.workTypeId}`}
                className="crew-trust-report__row"
                data-employee={row.employee.id}
                data-work-type={row.workTypeId}
                // 列的任何地方都可以點；鍵盤與螢幕閱讀器用第一格的按鈕
                onClick={openLedger && (() => openLedger(pair))}
              >
                <th scope="row" className="crew-trust-report__name">
                  {openLedger ? (
                    // 名稱是看得到的標題＋隱藏的「在工作帳本查看」（#153 第 4 點，WCAG 2.5.3）
                    <button type="button" className="link">
                      {title} <span className="visually-hidden">{t.reportOpenLedgerHidden}</span>
                    </button>
                  ) : (
                    title
                  )}
                </th>
                <Cell label={t.reportColumnReviews} num>
                  {row.reviews}
                </Cell>
                <Cell label={t.reportColumnFirstPass} num>
                  {percent === null ? t.reportNone : fill(t.reportFirstPass, { percent, ...row.firstPass })}
                </Cell>
                {REASONS.map((r) => {
                  const count = row.returns[r.reason];
                  return (
                    <Cell key={r.reason} label={t[r.key]} num>
                      {openLedger && count > 0 ? (
                        <button
                          type="button"
                          className="link crew-trust-report__count"
                          aria-label={fill(t.reportOpenReturned, { ...names, reason: t[r.key], count }, language)}
                          onClick={(e) => {
                            e.stopPropagation();
                            openLedger({ ...pair, event: "returned" });
                          }}
                        >
                          {count}
                        </button>
                      ) : (
                        count
                      )}
                    </Cell>
                  );
                })}
                <Cell label={t.reportColumnLevel}>
                  <LevelBadge level={row.level}>{levelText(row)}</LevelBadge>
                </Cell>
                <Cell label={t.reportColumnChanges}>
                  <span className="crew-trust-report__changes">
                    <span>{fill(t.reportChanges, { count: row.levelChanges }, language)}</span>
                    <span className="muted">
                      {row.lastChange === null
                        ? t.reportNoChange
                        : fill(t.reportLastChange, { date: shortDate(row.lastChange.at, language), change: t[CHANGE_TEXT[row.lastChange.kind]] })}
                    </span>
                  </span>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** 一格：手機改成卡片時，欄名由 data-label 顯示在數值前（CSS 的 ::before）。 */
function Cell({ label, num = false, children }: { label: string; num?: boolean; children: ReactNode }) {
  return (
    <td className={num ? "crew-trust-report__num" : undefined} data-label={label}>
      {children}
    </td>
  );
}
