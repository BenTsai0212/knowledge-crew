// 原文的接入點（#92 的 `## 決定` 1，crew ADR 0004 的 2026-11-22 修訂）：回流的文件在原文面板顯示
// 「來自 AI 員工 ○○・驗收「○○」（日期）」，點了回到「工作與驗收」的那一件。不是回流的文件、或目前身分看不到回流紀錄時不顯示。
// 文字在 client/i18n/crew/knowledge.<語言>.json；knowledge-kit 的原文元件（ui/SourcePanel.tsx、ui/SourceSheet.tsx）只留一個位置。
import { useEffect, useState } from "react";
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { crewStrings } from "../i18n";
import { readFlowbackOrigin, type FlowbackOrigin } from "../knowledge/origin";

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
  return (
    <p className="crew-source-origin">
      <button type="button" className="chip" onClick={() => onOpen(origin.assignmentId)}>
        {originText(origin, language)}
      </button>
    </p>
  );
}

/** 「來自 AI 員工 ○○・驗收「○○」（日期）」；日期是瀏覽器時區的年月日 */
export function originText(origin: FlowbackOrigin, language: LanguageCode): string {
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(origin.decidedAt));
  return fill(crewStrings("knowledge", language).origin, { employee: origin.employeeName, title: origin.title, date }, language);
}
