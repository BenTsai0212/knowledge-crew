// 原文的接入點（#92 的 `## 決定` 1，crew ADR 0004 的 2026-11-22 修訂）：回流的文件在原文面板顯示「這條知識經過的把關」（#147，ADR 0007 決定 8）：
// 「{員工} 整理・{驗收者} 驗收通過（日期）」與當時的審查層級、退回次數、自動檢查、依照的守則；「看這次驗收」回到「工作與驗收」的那一件。
// 不是回流的文件、或目前身分看不到回流紀錄時不顯示。
// 文字在 client/i18n/crew/knowledge.<語言>.json；knowledge-kit 的原文元件（ui/SourcePanel.tsx、ui/SourceSheet.tsx）只留一個位置。
import { useEffect, useId, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { crewStrings } from "../i18n";
import { readFlowbackOrigin, type FlowbackOrigin } from "../knowledge/origin";
import { actorName } from "./ledger";
import "./SourceOrigin.css";

interface Props {
  db: Database;
  identity: string | null;
  language: LanguageCode;
  documentId: string;
  /** 切到「工作與驗收」並選這個交辦 */
  onOpen(assignmentId: string): void;
}

export function SourceOrigin({ db, identity, language, documentId, onOpen }: Props) {
  const [origin, setOrigin] = useState<FlowbackOrigin | null>(null);
  const titleId = useId();
  useEffect(() => {
    let current = true;
    setOrigin(null);
    // 讀不到時不顯示（原文照常）
    readFlowbackOrigin(db, identity, documentId, language).then(
      (o) => current && setOrigin(o),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [db, identity, documentId, language]);
  if (origin === null) return null;
  const t = crewStrings("knowledge", language);
  const lines = originLines(origin, language);
  return (
    <section className="crew-source-origin" aria-labelledby={titleId}>
      <h3 id={titleId} className="crew-source-origin__title">
        {t.originTitle}
      </h3>
      <p>{lines.by}</p>
      <p className="muted">{lines.facts}</p>
      <p>
        <button type="button" className="chip" onClick={() => onOpen(origin.assignmentId)}>
          {t.originOpen}
        </button>
      </p>
    </section>
  );
}

/**
 * 兩行文字：「{員工} 整理・{驗收者} 驗收通過（日期）」，與以「・」連接的當時的把關（沒有的項目不顯示）。
 * 驗收者是身分的名稱（client/access.json）；日期是瀏覽器時區的年月日。
 */
export function originLines(origin: FlowbackOrigin, language: LanguageCode): { by: string; facts: string } {
  const t = crewStrings("knowledge", language);
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(origin.decidedAt));
  const reviewer = actorName(clientConfig.access, [], origin.decidedBy, language) ?? origin.decidedBy;
  const facts = [
    origin.level === "light" ? t.originLevelLight : t.originLevelItem,
    origin.returned === 0 ? t.originFirstTime : fill(t.originReturned, { count: origin.returned }, language),
    origin.checks && fill(t.originChecks, { passed: origin.checks.passed, total: origin.checks.total }, language),
    origin.guidelines > 0 && fill(t.originGuidelines, { count: origin.guidelines }, language),
  ].filter((x): x is string => typeof x === "string");
  return {
    by: fill(t.originBy, { employee: origin.employeeName, reviewer, date }, language),
    facts: facts.join(t.originSeparator),
  };
}
