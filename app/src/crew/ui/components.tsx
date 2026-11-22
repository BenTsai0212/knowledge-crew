// AI 員工畫面共用的元件（#66，設計規格 v3 第 4 節「元件」）：AI 標記、層級徽章、圓點（#83）、結論列、自動檢查列、收起的區塊。
// 文字在 client/i18n/crew/common.<語言>.json；樣式在 components.css（只用 theme.json 的變數）。
import { Fragment, type ReactNode } from "react";
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { CheckStatus, Dot, ReviewLevel } from "../trust/types";
import { crewStrings } from "../i18n";
import { checkLabel, checkSentence } from "./glossary";
import "./components.css";

type Tone = "fail" | "pending";
const ICON_PATH: Record<CheckStatus, string> = {
  fail: "M6 6l12 12M18 6L6 18",
  pass: "M5 12.5l4.5 4.5L19 7",
  pending: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2",
};

function Icon({ status, size }: { status: CheckStatus; size: number }) {
  return (
    <svg className="crew-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATH[status]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 「AI」標記：畫面上是等寬字的「AI」小框，螢幕閱讀器讀翻譯檔的完整說法。 */
export function AiMark({ language }: { language: LanguageCode }) {
  return (
    <span className="crew-ai-mark">
      <span aria-hidden="true">AI</span>
      <span className="visually-hidden">{crewStrings("common", language).aiMark}</span>
    </span>
  );
}

/** 員工名字：前面一律加 AI 標記。 */
export function EmployeeName({ name, language }: { name: string; language: LanguageCode }) {
  return (
    <span className="crew-employee-name">
      <AiMark language={language} />
      {name}
    </span>
  );
}

/** 表單選項（option 放不進元素）中的員工名字。 */
export const employeeOptionText = (name: string, language: LanguageCode) => fill(crewStrings("common", language).aiOption, { name });

/** 範本中的 {employee}（或 key 指定的參數）換成 EmployeeName，其他參數照 fill() 代入。 */
export function withEmployee(
  template: string,
  values: Record<string, string | number>,
  employee: string,
  language: LanguageCode,
  key = "employee",
): ReactNode {
  const parts = fill(template, values, language).split(`{${key}}`);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <EmployeeName name={employee} language={language} />}
      {part}
    </Fragment>
  ));
}

/** 層級徽章：逐項看是 textMuted 框＋text 字，少看是 success 框＋字（不填滿）。文字由畫面給（全文或簡寫）。 */
export function LevelBadge({ level, children }: { level: ReviewLevel; children: ReactNode }) {
  return (
    <span className="badge crew-level-badge" data-level={level}>
      {children}
    </span>
  );
}

const DOT_ARIA = { ok: "dotsAriaOk", wrong: "dotsAriaWrong", neutral: "dotsAriaNeutral" } as const satisfies Record<Dot, string>;

/** 圓點的 aria-label 摘要（例如「通過 9、做錯了 1」）：沒有的結果不列出。文字在 trust 翻譯檔。 */
export function dotsSummary(dots: readonly Dot[], language: LanguageCode): string {
  const t = crewStrings("trust", language);
  const counts: Record<Dot, number> = { ok: 0, wrong: 0, neutral: 0 };
  for (const d of dots) counts[d] += 1;
  return (Object.keys(DOT_ARIA) as Dot[])
    .filter((d) => counts[d] > 0)
    .map((d) => fill(t[DOT_ARIA[d]], { count: counts[d] }))
    .join(t.dotsAriaSeparator);
}

/** 一個圓點（設計規格 v3 第 4 節）：通過＝success 實心圓、做錯了＝danger 粗體 ×、其他退回＝textMuted 虛線空心圓；none 是不足的空格。 */
export function DotMark({ dot, className }: { dot: Dot | "none"; className?: string }) {
  return (
    <span className={className === undefined ? "crew-dot" : `crew-dot ${className}`} data-dot={dot} aria-hidden="true">
      {dot === "wrong" ? "×" : ""}
    </span>
  );
}

/** 一排圓點（員工卡）：整排是一張圖，aria-label 是摘要。信任頁的時間軸以同一個 DotMark 與 dotsSummary() 排成格線。 */
export function DotRow({ dots, language }: { dots: readonly Dot[]; language: LanguageCode }) {
  return (
    <span className="crew-dots" role="img" aria-label={dotsSummary(dots, language)}>
      {dots.map((d, i) => (
        <DotMark key={i} dot={d} />
      ))}
    </span>
  );
}

/** 結論列：未通過（danger）或檢查中（warning）；沒有問題時畫面不放這個元件。 */
export function ConclusionRow({ tone, title, description }: { tone: Tone; title: string; description: ReactNode }) {
  return (
    <div className="crew-conclusion" data-tone={tone}>
      <Icon status={tone} size={24} />
      <p className="crew-conclusion__title">{title}</p>
      <p className="crew-conclusion__description">{description}</p>
    </div>
  );
}

const CHECK_TEXT = { pass: "checkPass", fail: "checkFail", pending: "checkPending" } as const satisfies Record<CheckStatus, string>;

/** 自動檢查列：圖示＋白話名稱與說明＋右側狀態。未通過有 danger 框，通過與檢查中無框；都不用底色。 */
export function CheckRow({ name, status, language }: { name: string; status: CheckStatus; language: LanguageCode }) {
  const sentence = checkSentence(name, status, language);
  return (
    <div className="crew-check" data-status={status}>
      <Icon status={status} size={20} />
      <span className="crew-check__text">
        <span className="crew-check__name">{checkLabel(name, language)}</span>
        {sentence !== null && <span className="crew-check__sentence">{sentence}</span>}
      </span>
      <span className="crew-check__status">{crewStrings("review", language)[CHECK_TEXT[status]]}</span>
    </div>
  );
}

interface CollapsedFieldsProps {
  id: string;
  fields: string[];
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  language: LanguageCode;
  children: ReactNode;
}

/** 收起的區塊：按鈕（鍵盤可操作）切換展開；aria-expanded 與 aria-controls 指向內容。展開狀態由畫面保存。 */
export function CollapsedFields({ id, fields, expanded, onToggle, language, children }: CollapsedFieldsProps) {
  const t = crewStrings("common", language);
  const summary = fill(t.collapsedFields, { count: fields.length, fields: fields.join(t.collapsedFieldsSeparator) }, language);
  return (
    <div className="crew-collapsed" data-expanded={expanded}>
      <button type="button" className="crew-collapsed__toggle" aria-expanded={expanded} aria-controls={id} onClick={() => onToggle(!expanded)}>
        <svg className="crew-icon crew-collapsed__chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 6l6 6l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {expanded ? t.collapseFields : summary}
      </button>
      <div id={id} className="crew-collapsed__content" hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
