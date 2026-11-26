// 原文的接入點（#92 的 `## 決定` 1，crew ADR 0004 的 2026-11-22 修訂）：回流的文件在原文面板顯示「這條知識經過的把關」（#147，ADR 0007 決定 8）：
// 「{員工} 整理・{驗收者} 驗收通過（日期）」與當時的審查層級、退回次數、自動檢查、依照的守則；「看這次驗收」回到「工作與驗收」的那一件。
// 守則的文件（#149，ADR 0007 決定 7）顯示「這條守則的來歷」：誰的守則、誰確認、來自哪一次退回、生效中或已收回；
// 「看那次退回」回到「工作與驗收」的來源交辦，「到員工頁」捲到員工卡。兩種文件的 id 格式不同，不會同時出現。
// 不是這兩種文件、或目前身分看不到紀錄時不顯示（原文照常）。
// 文字在 client/i18n/crew/knowledge.<語言>.json；knowledge-kit 的原文元件（ui/SourcePanel.tsx、ui/SourceSheet.tsx）只留一個位置。
import { useEffect, useId, useState, type ReactNode } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { crewStrings } from "../i18n";
import { reasonLabel } from "../knowledge/guideline-document";
import { readFlowbackOrigin, readGuidelineOrigin, type FlowbackOrigin, type GuidelineOrigin } from "../knowledge/origin";
import { withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import { actorName } from "./ledger";
import { shortDate } from "./trust";
import "./SourceOrigin.css";

interface Props {
  db: Database;
  identity: string | null;
  language: LanguageCode;
  documentId: string;
  /** 切到「工作與驗收」並選這個交辦 */
  onOpen(assignmentId: string): void;
  /** 切到「員工」並捲到這位員工的卡片（守則的文件） */
  onOpenEmployee(employeeId: string): void;
}

type Found = { kind: "flowback"; origin: FlowbackOrigin } | { kind: "guideline"; origin: GuidelineOrigin };

export function SourceOrigin({ db, identity, language, documentId, onOpen, onOpenEmployee }: Props) {
  const [found, setFound] = useState<Found | null>(null);
  const titleId = useId();
  useEffect(() => {
    let current = true;
    setFound(null);
    // 讀不到時不顯示（原文照常）；回流的紀錄與守則的文件紀錄只會有一個
    (async (): Promise<Found | null> => {
      const flowback = await readFlowbackOrigin(db, identity, documentId, language);
      if (flowback !== null) return { kind: "flowback", origin: flowback };
      const guideline = await readGuidelineOrigin(db, identity, documentId, language);
      return guideline === null ? null : { kind: "guideline", origin: guideline };
    })().then(
      (f) => current && setFound(f),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [db, identity, documentId, language]);
  if (found === null) return null;
  const t = crewStrings("knowledge", language);
  if (found.kind === "guideline") {
    const g = found.origin;
    const lines = guidelineLines(g, language);
    return (
      <section className={`crew-source-origin${g.revokedAt === null ? "" : " crew-source-origin--revoked"}`} aria-labelledby={titleId}>
        <h3 id={titleId} className="crew-source-origin__title">
          {t.guidelineTitle}
        </h3>
        <p>{lines.by}</p>
        <p className="muted">{lines.from}</p>
        <p className={g.revokedAt === null ? "muted" : "crew-source-origin__status"}>{lines.status}</p>
        <p className="crew-source-origin__actions">
          <button type="button" className="chip" onClick={() => onOpen(g.assignmentId)}>
            {t.guidelineOpenReturn}
          </button>
          <button type="button" className="chip" onClick={() => onOpenEmployee(g.employeeId)}>
            {t.guidelineOpenEmployee}
          </button>
        </p>
      </section>
    );
  }
  const origin = found.origin;
  const lines = originLines(origin, language);
  return (
    <section className="crew-source-origin" aria-labelledby={titleId}>
      <h3 id={titleId} className="crew-source-origin__title">
        {t.originTitle}
      </h3>
      <p>{lines.by}</p>
      <p className="muted">{lines.facts}</p>
      {lines.corrected !== null && <p className="crew-source-origin__corrected">{lines.corrected}</p>}
      <p>
        <button type="button" className="chip" onClick={() => onOpen(origin.assignmentId)}>
          {t.originOpen}
        </button>
      </p>
    </section>
  );
}

/**
 * 兩行：「{員工} 整理・{驗收者} 驗收通過（日期）」，與以「・」連接的當時的把關（沒有的項目不顯示）。
 * 通過後被事後更正時（#164，crew ADR 0008 第 5 點）加一行「通過後發現有錯（日期）」；沒有更正時 `corrected` 是 null。
 * 員工名字加 AI 標記（EmployeeName）；驗收者是身分的名稱（client/access.json）；日期與員工卡、工作帳本相同的 MM/DD（shortDate，#151）。
 */
export function originLines(origin: FlowbackOrigin, language: LanguageCode): { by: ReactNode; facts: string; corrected: string | null } {
  const t = crewStrings("knowledge", language);
  const date = shortDate(origin.decidedAt, language);
  const reviewer = actorName(clientConfig.access, [], origin.decidedBy, language) ?? origin.decidedBy;
  const facts = [
    origin.level === "light" ? t.originLevelLight : t.originLevelItem,
    origin.returned === 0 ? t.originFirstTime : fill(t.originReturned, { count: origin.returned }, language),
    origin.checks && fill(t.originChecks, { passed: origin.checks.passed, total: origin.checks.total }, language),
    origin.guidelines > 0 && fill(t.originGuidelines, { count: origin.guidelines }, language),
  ].filter((x): x is string => typeof x === "string");
  return {
    by: withEmployee(t.originBy, { reviewer, date }, origin.employeeName, language),
    facts: facts.join(t.originSeparator),
    corrected: origin.correctedAt === null ? null : fill(t.originCorrected, { date: shortDate(origin.correctedAt, language) }),
  };
}

/**
 * 守則的三行：「{員工} 的「{工作類型}」守則・{確認者} {日期} 確認」（修改後確認時加註）、「來自 {日期} 的退回（{原因}）」與提出方式、
 * 「生效中・之後依照 n 次」或「已收回（日期），之後的交件不再依照這條」。
 * 員工名字加 AI 標記（EmployeeName）；日期與員工卡、工作帳本相同的 MM/DD（shortDate，#151）。
 */
export function guidelineLines(origin: GuidelineOrigin, language: LanguageCode): { by: ReactNode; from: ReactNode; status: string } {
  const t = crewStrings("knowledge", language);
  const date = (iso: string) => shortDate(iso, language);
  const confirmer = actorName(clientConfig.access, [], origin.confirmedBy, language) ?? origin.confirmedBy;
  const by = { workType: workTypeLabel(origin.workTypeId, language), confirmer, date: date(origin.confirmedAt) };
  const from = { date: date(origin.returnedAt), reason: reasonLabel(origin.reason, language) };
  return {
    by: (
      <>
        {withEmployee(t.guidelineBy, by, origin.employeeName, language)}
        {origin.revised && t.guidelineRevised}
      </>
    ),
    from: withEmployee(origin.proposerKind === "employee" ? t.guidelineFromEmployee : t.guidelineFromHuman, from, origin.employeeName, language),
    status: origin.revokedAt === null
      ? fill(t.guidelineActive, { count: origin.followed }, language)
      : fill(t.guidelineRevoked, { date: date(origin.revokedAt) }, language),
  };
}
