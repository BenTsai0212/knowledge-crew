// 驗收面板 v3 的交件內容共用的小元件（#72 計畫第 3、4 點）：上標的重點編號、依標記切開的內容、
// 區塊的名稱欄（名稱＋整個區塊的重點＋「已修改」）與內容（data-point／data-active）。四種交件與一般的寫法共用。
import type { ReactNode } from "react";
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { WorkSection } from "../../work/body";
import { crewStrings } from "../../i18n";
import { segments } from "./marked";

/** 目前選中的重點編號（從 1 開始）；沒有選中是 null */
export type ActivePoint = number | null;

/** 畫一份交件內容需要的共用資料 */
export interface SectionContext {
  language: LanguageCode;
  active: ActivePoint;
  /** 區塊的鍵 → 變更的說明（只有逐項看的變更） */
  modified: ReadonlyMap<string, string>;
}

/** 上標的重點編號；螢幕閱讀器讀「重點 N」 */
export function PointNumber({ n, language }: { n: number; language: LanguageCode }) {
  return (
    <>
      <sup className="crew-point-number" aria-hidden="true">
        {n}
      </sup>
      <span className="visually-hidden">{fill(crewStrings("review", language).pointMark, { n })}</span>
    </>
  );
}

/** 整個區塊的重點（`[point N]`）的上標編號 */
export function WholePoints({ section, language }: { section: WorkSection; language: LanguageCode }) {
  return (
    <>
      {section.attrs.points.map((n) => (
        <PointNumber key={n} n={n} language={language} />
      ))}
    </>
  );
}

/** 區塊有變更時的「已修改：…」 */
export function Modified({ section, ctx }: { section: WorkSection; ctx: SectionContext }) {
  const summary = ctx.modified.get(section.key!);
  return summary === undefined ? null : <span className="crew-review__modified">{fill(crewStrings("review", ctx.language).modified, { summary })}</span>;
}

/** 區塊的內容：依 marks 切成片段，重點片段畫底線＋上標 */
export function MarkedText({ section, ctx }: { section: WorkSection; ctx: SectionContext }) {
  return (
    <>
      {segments(section.text, section.marks).map((s, i) =>
        s.point === null ? (
          s.text
        ) : (
          <span key={i} className="crew-review__mark" data-point={s.point} data-active={s.point === ctx.active || undefined}>
            {s.text}
            <PointNumber n={s.point} language={ctx.language} />
          </span>
        ),
      )}
    </>
  );
}

/** 整個區塊是重點時的 data-point（以空白分隔的編號）與選中時的 data-active */
export function pointAttrs(section: WorkSection, active: ActivePoint) {
  const whole = section.attrs.points;
  return {
    "data-point": whole.length > 0 ? whole.join(" ") : undefined,
    "data-active": (active !== null && whole.includes(active)) || undefined,
  };
}

interface BlockProps {
  section: WorkSection;
  /** 左側欄的名稱 */
  name: ReactNode;
  ctx: SectionContext;
  /** 內容前面的東西（貼文帳號的首字等） */
  before?: ReactNode;
  /** 內容（預設是依標記切開的 section.text） */
  children?: ReactNode;
}

/** 一個區塊：左側欄放名稱、整個區塊的重點與「已修改」，右側是內容。data-part 是區塊的鍵，給各交件的樣式用。 */
export function Block({ section, name, ctx, before, children }: BlockProps) {
  return (
    <div className="crew-review__block" data-part={section.key ?? undefined}>
      <div className="crew-review__block-name">
        <span>{name}</span>
        <WholePoints section={section} language={ctx.language} />
        <Modified section={section} ctx={ctx} />
      </div>
      <div className="crew-review__block-text" {...pointAttrs(section, ctx.active)}>
        {before}
        {children ?? <MarkedText section={section} ctx={ctx} />}
      </div>
    </div>
  );
}
