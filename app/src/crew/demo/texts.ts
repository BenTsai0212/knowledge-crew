// 虛構資料的雙語文字（#29 的 `## 決定` 1）：資料庫只存預設語言，畫面以 demoText() 換成目前語言。
// 找不到時（人在 demo 中新增的交辦、或該語言沒有文字）回傳 null，畫面顯示資料庫的原文。
import type { LanguageCode, LocalizedText } from "../../client/types";
import { DEMO } from "./load";
import { demoWorkId, type DemoFile } from "./types";

/**
 * 文字的種類與 id：
 * - `roleNote`：員工 id；`title`：交辦 id
 * - `summary`、`body`：工作 id（`<交辦 id>-w<round>`）
 * - `point`、`change`：`<工作 id>/<ordinal>`（ordinal 從 1 開始，與資料表相同）
 */
export type DemoTextKind = "roleNote" | "title" | "summary" | "body" | "point" | "change";

export type DemoTextIndex = ReadonlyMap<string, LocalizedText>;

const key = (kind: DemoTextKind, id: string) => `${kind}:${id}`;

export function demoTextIndex(demo: DemoFile): DemoTextIndex {
  const index = new Map<string, LocalizedText>();
  for (const e of demo.employees) index.set(key("roleNote", e.id), e.roleNote);
  for (const a of demo.assignments) {
    index.set(key("title", a.id), a.title);
    for (const w of a.works) {
      const workId = demoWorkId(a.id, w.round);
      index.set(key("summary", workId), w.summary);
      index.set(key("body", workId), w.body);
      w.points.forEach((p, i) => index.set(key("point", `${workId}/${i + 1}`), p));
      w.changes.forEach((c, i) => index.set(key("change", `${workId}/${i + 1}`), c.summary));
    }
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
