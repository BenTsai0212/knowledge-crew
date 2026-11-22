// 驗收面板 v3 的交件本身與重點卡（#72 計畫第 1、4 點）：依 parseWorkBody() 的區塊逐一列出，左側欄放區塊名稱與「已修改」，
// 重點在內容中畫底線＋上標編號。不能標出重點（舊格式、解析有錯）時退回純文字。
// 點選重點（重點卡的按鈕與內容的底色）與四種交件各自的樣子在之後的 PR 依同一套標記加上。
import { fill } from "../../../client/i18n";
import type { LanguageCode } from "../../../client/types";
import type { ChangesView } from "../../trust/types";
import { toPlainText, type ParsedBody, type WorkSection } from "../../work/body";
import { crewStrings } from "../../i18n";
import { isCodePosition, positionLabel } from "../glossary";
import { pointPlaces } from "./conclusion";
import { canMark, segments } from "./marked";

/** 上標的重點編號；螢幕閱讀器讀「重點 N」 */
function PointNumber({ n, language }: { n: number; language: LanguageCode }) {
  return (
    <>
      <sup className="crew-point-number" aria-hidden="true">
        {n}
      </sup>
      <span className="visually-hidden">{fill(crewStrings("review", language).pointMark, { n })}</span>
    </>
  );
}

interface PointListProps {
  points: string[];
  body: ParsedBody;
  language: LanguageCode;
}

/** 重點卡：每點一列，編號＋重點文字＋在內容中的位置（沒有位置時不顯示）。 */
export function PointList({ points, body, language }: PointListProps) {
  const places = pointPlaces(body, language);
  const separator = crewStrings("review", language).listSeparator;
  return (
    <ol className="crew-review__points">
      {points.map((text, i) => {
        const n = i + 1;
        const where = places[i] ?? [];
        return (
          <li key={i} className="crew-review__point">
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
          </li>
        );
      })}
    </ol>
  );
}

/** 區塊的內容：依 marks 切成片段，重點片段畫底線＋上標 */
function MarkedText({ section, language }: { section: WorkSection; language: LanguageCode }) {
  return (
    <>
      {segments(section.text, section.marks).map((s, i) =>
        s.point === null ? (
          s.text
        ) : (
          <span key={i} className="crew-review__mark" data-point={s.point}>
            {s.text}
            <PointNumber n={s.point} language={language} />
          </span>
        ),
      )}
    </>
  );
}

interface BodyViewProps {
  /** 交件的稱呼（「回信草稿」等），是交件卡的名稱 */
  name: string;
  body: ParsedBody;
  /** 原始全文：不能標出重點時以純文字顯示 */
  raw: string;
  changes: ChangesView;
  language: LanguageCode;
}

export function BodyView({ name, body, raw, changes, language }: BodyViewProps) {
  const t = crewStrings("review", language);
  const modified = new Map(changes.mode === "items" ? changes.items.map((c) => [c.path, c.summary]) : []);

  const sectionName = (s: WorkSection) => (s.key === "pr/description" ? t.prDescription : (s.label ?? positionLabel(s.key!, language)));
  return (
    <article className="card crew-review__body-card" aria-label={name}>
      {canMark(body) ? (
        <div className="crew-review__sections">
          {body.sections.map((s) => {
            const summary = modified.get(s.key!);
            const whole = s.attrs.points;
            return (
              <div key={s.key} className="crew-review__block">
                <div className="crew-review__block-name">
                  <span className={isCodePosition(s.key!) && s.label === null && s.key !== "pr/description" ? "crew-review__ref" : undefined}>{sectionName(s)}</span>
                  {whole.map((n) => (
                    <PointNumber key={n} n={n} language={language} />
                  ))}
                  {summary !== undefined && <span className="crew-review__modified">{fill(t.modified, { summary })}</span>}
                </div>
                <div
                  className="crew-review__block-text"
                  data-point={whole.length > 0 ? whole.join(" ") : undefined}
                >
                  <MarkedText section={s} language={language} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="crew-review__body">{toPlainText(raw)}</p>
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
        <p className="muted crew-review__changes-line">{fill(t.changesSummary, { count: changes.count }, language)}</p>
      )}
    </article>
  );
}
