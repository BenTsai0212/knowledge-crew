// 驗收面板 v3 的交件本身與重點卡（#72 計畫第 1、4 點）：依 parseWorkBody() 的區塊逐一列出，左側欄放區塊名稱與「已修改」，
// 重點在內容中畫底線＋上標編號。不能標出重點（舊格式、解析有錯）時退回純文字。
// 點選重點：重點卡的列是 aria-pressed 的按鈕，選中時內容中 data-point 相符的位置加 data-active（surfaceRaised 底）。
// 交件類型是回信、貼文、知識庫條目或程式修改時，依 Deliverables.tsx 以原本的樣子呈現。
import { useState } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { ChangesView, WorkChange } from "../../trust/types";
import { toPlainText, type ParsedBody, type WorkSection } from "../../work/body";
import { crewStrings, type CrewTexts } from "../../i18n";
import { isCodePosition, positionLabel } from "../glossary";
import { pointPlaces, type Deliverable } from "./conclusion";
import { CodeBody, KbBody, PostBody, ReplyBody } from "./Deliverables";
import { canMark, pointLocated } from "./marked";
import { Block, type ActivePoint, type SectionContext } from "./parts";

export type { ActivePoint } from "./parts";

interface PointListProps {
  points: string[];
  body: ParsedBody;
  language: LanguageCode;
  active?: ActivePoint;
  /** 點選第 n 個重點（從 1 開始）；再點一次由呼叫端取消 */
  onToggle?: (n: number) => void;
}

/**
 * 重點卡：每點一列，編號＋重點文字＋在內容中的位置（沒有位置時不顯示）。
 * 在內容中有位置的列是 `aria-pressed` 的按鈕；沒有位置的列（舊格式、解析有錯、該重點沒有標記）是一般的文字。
 */
export function PointList({ points, body, language, active = null, onToggle }: PointListProps) {
  const places = pointPlaces(body, language);
  const separator = crewStrings("review", language).listSeparator;
  return (
    <ol className="crew-review__points">
      {points.map((text, i) => {
        const n = i + 1;
        const where = places[i] ?? [];
        const content = (
          <>
            <span className="crew-review__point-number" aria-hidden="true">
              {n}
            </span>
            <span className="crew-review__point-text">
              {text}
              {where.length > 0 && (
                <span className="crew-review__point-place">
                  {where.map((p, j) => (
                    <span key={j} className={p.code ? "crew-review__ref" : undefined}>
                      {j > 0 && separator}
                      {p.text}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={i}>
            {onToggle !== undefined && pointLocated(body, i) ? (
              <button type="button" className="crew-review__point" aria-pressed={active === n} onClick={() => onToggle(n)}>
                {content}
              </button>
            ) : (
              <div className="crew-review__point">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 一般的寫法（交件類型不是四種之一）的區塊名稱：程式檔案路徑以等寬字顯示 */
function SectionName({ section: s, t, language }: { section: WorkSection; t: CrewTexts<"review">; language: LanguageCode }) {
  if (s.key === "pr/description") return t.prDescription;
  if (s.label !== null) return s.label;
  return <span className={isCodePosition(s.key!) ? "crew-review__ref" : undefined}>{positionLabel(s.key!, language)}</span>;
}

interface BodyViewProps {
  /** 交件的稱呼（「回信草稿」等），是交件卡的名稱 */
  name: string;
  body: ParsedBody;
  /** 原始全文：不能標出重點時以純文字顯示 */
  raw: string;
  changes: ChangesView;
  language: LanguageCode;
  active?: ActivePoint;
  /** 交件類型：決定呈現的樣子；null 是一般的寫法（依序列出區塊） */
  deliverable?: Deliverable | null;
  /** 程式修改的來源與編號（差異的參照） */
  reference?: string | null;
  /** 少看時收成一行的變更（「逐項列出」展開時列出）；沒有時只顯示件數 */
  changeItems?: readonly WorkChange[];
}

export function BodyView({ name, body, raw, changes, language, active = null, deliverable = null, reference = null, changeItems = [] }: BodyViewProps) {
  const t = crewStrings("review", language);
  const ctx: SectionContext = {
    language,
    active,
    modified: new Map(changes.mode === "items" ? changes.items.map((c) => [c.path, c.summary]) : []),
    // reviewFocus() 只在少看且有標重點時把變更收成一行；收起欄位用同一個條件（沒標重點時不收）
    light: changes.mode === "summary",
  };
  const sections = body.sections;
  return (
    <article className="card crew-review__body-card" aria-label={name} data-deliverable={canMark(body) ? (deliverable ?? undefined) : undefined}>
      {!canMark(body) ? (
        <p className="crew-review__body">{toPlainText(raw)}</p>
      ) : deliverable === "reply" ? (
        <ReplyBody sections={sections} ctx={ctx} />
      ) : deliverable === "post" ? (
        <PostBody sections={sections} ctx={ctx} />
      ) : deliverable === "kb" ? (
        <KbBody sections={sections} ctx={ctx} />
      ) : deliverable === "code" ? (
        <CodeBody sections={sections} ctx={ctx} reference={reference} />
      ) : (
        <div className="crew-review__sections">
          {sections.map((s) => (
            <Block key={s.key} section={s} name={<SectionName section={s} t={t} language={language} />} ctx={ctx} />
          ))}
        </div>
      )}
      {changes.mode === "items" ? (
        changes.items.length > 0 && (
          <p className="muted crew-review__changes-line">
            {fill(
              t.changesLine,
              { count: changes.items.length, places: changes.items.map((c) => positionLabel(c.path, language)).join(t.changesSeparator) },
              language,
            )}
          </p>
        )
      ) : (
        changes.count > 0 && <CollapsedChanges count={changes.count} items={changeItems} language={language} />
      )}
    </article>
  );
}

/** 少看的變更：收成一行「變更 N 項已收起（少看）：…」＋「逐項列出」；展開狀態只存在元件 state */
function CollapsedChanges({ count, items, language }: { count: number; items: readonly WorkChange[]; language: LanguageCode }) {
  const t = crewStrings("review", language);
  const [expanded, setExpanded] = useState(false);
  const places = items.map((c) => c.summary).join(t.listSeparator);
  return (
    <div className="crew-review__changes-collapsed">
      <p className="muted crew-review__changes-line">
        {fill(t.changesSummary, { count, places }, language)}
        {items.length > 0 && (
          <>
            {" "}
            <button type="button" className="link" aria-expanded={expanded} aria-controls="crew-review-changes" onClick={() => setExpanded(!expanded)}>
              {expanded ? t.changesHide : t.changesList}
            </button>
          </>
        )}
      </p>
      {items.length > 0 && (
        <ul id="crew-review-changes" className="crew-review__changes-items" hidden={!expanded}>
          {items.map((c) => (
            <li key={c.path}>
              <span className={isCodePosition(c.path) ? "crew-review__ref" : undefined}>{positionLabel(c.path, language)}</span>
              {t.changesItemSeparator}
              {c.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
