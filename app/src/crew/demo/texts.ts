// 虛構資料的雙語文字（#29 的 `## 決定` 1）：資料庫只存預設語言，畫面以 demoText() 換成目前語言。
// 找不到時（人在 demo 中新增的交辦、或該語言沒有文字）回傳 null，畫面顯示資料庫的原文。
import type { LanguageCode, LocalizedText } from "../../client/types";
import { DEMO } from "./load";
import { demoGuidelineDecisionId, demoWorkId, type DemoFile } from "./types";

/**
 * 文字的種類與 id：
 * - `roleNote`：員工 id；`title`：交辦 id；`sourceName`：來源 id（來源的 `label`，#60）
 * - `summary`、`body`：工作 id（`<交辦 id>-w<round>`）
 * - `point`、`change`：`<工作 id>/<ordinal>`（ordinal 從 1 開始，與資料表相同）
 * - `reviewNote`：驗收 id（退回的意見）；`guideline`：守則 id（提出的文字）；`guidelineRevision`：決定 id（確認時修改的文字）（#142）
 * - `correctionNote`：事後更正 id（更正的備註，#161）
 */
export type DemoTextKind =
  | "sourceName" | "roleNote" | "title" | "summary" | "body" | "point" | "change" | "reviewNote" | "guideline" | "guidelineRevision" | "correctionNote";

export type DemoTextIndex = ReadonlyMap<string, LocalizedText>;

const key = (kind: DemoTextKind, id: string) => `${kind}:${id}`;

export function demoTextIndex(demo: DemoFile): DemoTextIndex {
  const index = new Map<string, LocalizedText>();
  for (const s of demo.sources) if (s.label) index.set(key("sourceName", s.id), s.label);
  for (const e of demo.employees) index.set(key("roleNote", e.id), e.roleNote);
  for (const a of demo.assignments) {
    index.set(key("title", a.id), a.title);
    for (const w of a.works) {
      const workId = demoWorkId(a.id, w.round);
      index.set(key("summary", workId), w.summary);
      index.set(key("body", workId), w.body);
      w.points.forEach((p, i) => index.set(key("point", `${workId}/${i + 1}`), p));
      w.changes.forEach((c, i) => index.set(key("change", `${workId}/${i + 1}`), c.summary));
      if (w.review?.note) index.set(key("reviewNote", w.review.id), w.review.note);
      const correction = w.review?.verdict === "accepted" ? w.review.correction : undefined;
      if (correction?.note) index.set(key("correctionNote", correction.id), correction.note);
    }
  }
  for (const g of demo.guidelines ?? []) {
    index.set(key("guideline", g.id), g.text);
    g.decisions.forEach((d, i) => d.revisedText && index.set(key("guidelineRevision", demoGuidelineDecisionId(g.id, i + 1)), d.revisedText));
  }
  return index;
}

const DEFAULT_INDEX: DemoTextIndex = DEMO ? demoTextIndex(DEMO) : new Map();

export function demoText(
  kind: DemoTextKind,
  id: string,
  language: LanguageCode,
  index: DemoTextIndex = DEFAULT_INDEX,
): string | null {
  const texts = index.get(key(kind, id));
  return texts && Object.hasOwn(texts, language) ? texts[language] : null;
}
