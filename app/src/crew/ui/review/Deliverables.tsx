// 驗收面板 v3 的四種交件（#72 計畫第 3 點；設計規格 v3 第 6.2 節）：回信、貼文、知識庫條目、程式修改，
// 各自以原本的樣子呈現。區塊與重點的標記沿用 parts.tsx；段落與部分的名稱、其他文字都在翻譯檔。
import type { ReactNode } from "react";
import type { WorkSection } from "../../work/body";
import { crewStrings } from "../../i18n";
import { positionLabel } from "../glossary";
import { Block, MarkedText, Modified, WholePoints, pointAttrs, type SectionContext } from "./parts";

export interface DeliverableProps {
  sections: readonly WorkSection[];
  ctx: SectionContext;
}

const REPLY_HEAD = new Set(["reply/to", "reply/subject"]);

/** 回信：上方是寄給與主旨，下方依序是段落；左側欄是段落名稱 */
export function ReplyBody({ sections, ctx }: DeliverableProps) {
  const block = (s: WorkSection) => <Block key={s.key} section={s} name={positionLabel(s.key!, ctx.language)} ctx={ctx} />;
  const head = sections.filter((s) => REPLY_HEAD.has(s.key!));
  return (
    <div className="crew-review__sections">
      {head.length > 0 && <div className="crew-review__reply-head">{head.map(block)}</div>}
      {sections.filter((s) => !REPLY_HEAD.has(s.key!)).map(block)}
    </div>
  );
}

/** 貼文：帳號列（圓形首字）、標題、內文、標籤、圖片（虛線框的佔位方塊，demo 沒有圖片檔）與圖片說明 */
export function PostBody({ sections, ctx }: DeliverableProps) {
  return (
    <div className="crew-review__sections">
      {sections.map((s) => {
        const before =
          s.key === "post/account" && s.text !== "" ? (
            <span className="crew-review__avatar" aria-hidden="true">
              {Array.from(s.text)[0]}
            </span>
          ) : undefined;
        return <Block key={s.key} section={s} name={positionLabel(s.key!, ctx.language)} ctx={ctx} before={before} />;
      })}
    </div>
  );
}

/** 知識庫條目：條目名稱＋欄位清單；空白的必填欄位是 danger 虛線框的「空白・必填」 */
export function KbBody({ sections, ctx }: DeliverableProps) {
  const t = crewStrings("review", ctx.language);
  // 條目區塊（`kb/<條目>`）開始一組，之後的欄位（`kb/<條目>#<欄位>`）放進同一組的欄位清單
  const groups: { entry: WorkSection | null; fields: WorkSection[] }[] = [];
  for (const s of sections) {
    if (!s.key!.includes("#")) groups.push({ entry: s, fields: [] });
    else if (groups.length === 0) groups.push({ entry: null, fields: [s] });
    else groups.at(-1)!.fields.push(s);
  }
  const value = (s: WorkSection): ReactNode => {
    if (s.text !== "") return <MarkedText section={s} ctx={ctx} />;
    return s.attrs.required ? <span className="crew-review__empty-required">{t.fieldEmptyRequired}</span> : <span className="muted">{t.fieldEmpty}</span>;
  };
  return (
    <div className="crew-review__sections">
      {groups.map(({ entry, fields }, i) => (
        <div key={entry?.key ?? i} className="crew-review__kb-entry">
          {entry && (
            <div className="crew-review__kb-head">
              <p className="crew-review__kb-title" {...pointAttrs(entry, ctx.active)}>
                {entry.label ?? positionLabel(entry.key!, ctx.language)}
                <WholePoints section={entry} language={ctx.language} />
              </p>
              <Modified section={entry} ctx={ctx} />
              {entry.text !== "" && (
                <p className="crew-review__block-text">
                  <MarkedText section={entry} ctx={ctx} />
                </p>
              )}
            </div>
          )}
          {fields.length > 0 && (
            <dl className="crew-review__fields">
              {fields.map((s) => (
                <div key={s.key} className="crew-review__block">
                  <dt className="crew-review__block-name">
                    <span>
                      {s.label ?? positionLabel(s.key!, ctx.language)}
                      {s.attrs.required && <span className="crew-review__required">{t.fieldRequired}</span>}
                    </span>
                    <WholePoints section={s} language={ctx.language} />
                    <Modified section={s} ctx={ctx} />
                  </dt>
                  <dd className="crew-review__block-text" {...pointAttrs(s, ctx.active)}>
                    {value(s)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

interface CodeProps extends DeliverableProps {
  /** 來源與編號（「example-org/company-site#26・PR #38」）；demo 的 repo 是虛構的，只顯示文字、不放連結 */
  reference: string | null;
}

/** 程式修改：檔案清單（新增或修改＋一句說明）、預設收起的 PR 描述、差異的參照與「合併在 GitHub 進行」 */
export function CodeBody({ sections, ctx, reference }: CodeProps) {
  const t = crewStrings("review", ctx.language);
  const files = sections.filter((s) => s.key !== "pr/description");
  const pr = sections.find((s) => s.key === "pr/description");
  const [beforeRef, afterRef] = t.codeDiff.split("{ref}");
  return (
    <div className="crew-review__sections">
      {files.length > 0 && (
        <ul className="crew-review__files" aria-label={t.codeFiles}>
          {files.map((s) => (
            <li key={s.key} className="crew-review__file">
              <div className="crew-review__file-head">
                <span className="crew-review__ref">{s.key}</span>
                <WholePoints section={s} language={ctx.language} />
                {s.attrs.change !== null && (
                  <span className="badge" data-change={s.attrs.change}>
                    {s.attrs.change === "added" ? t.fileAdded : t.fileModified}
                  </span>
                )}
                <Modified section={s} ctx={ctx} />
              </div>
              <div className="crew-review__block-text" {...pointAttrs(s, ctx.active)}>
                <MarkedText section={s} ctx={ctx} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {pr && (
        <details className="crew-review__details crew-review__pr">
          <summary>
            {t.prDescription}
            <WholePoints section={pr} language={ctx.language} />
          </summary>
          <div className="crew-review__block-text" {...pointAttrs(pr, ctx.active)}>
            <MarkedText section={pr} ctx={ctx} />
          </div>
        </details>
      )}
      {reference !== null && (
        <p className="muted crew-review__code-ref">
          {beforeRef}
          <span className="crew-review__ref">{reference}</span>
          {afterRef}
        </p>
      )}
      <p className="muted crew-review__merge-note">{t.mergeNote}</p>
    </div>
  );
}
