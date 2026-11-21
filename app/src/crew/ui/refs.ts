// 工作來源與外部編號的顯示（#57 計畫第 3、4 節）：資料庫只存編號的值，格式依來源類型由畫面組出，
// 文字在 client/i18n/crew/common.<語言>.json（ref*）。repo 類照舊是 `<repo>#<Issue>` 與 `PR #<編號>`。
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { SourceKind } from "../db/store";
import { demoText, type DemoTextIndex } from "../demo/texts";
import { crewStrings } from "../i18n";

export interface SourceRef {
  sourceKind: SourceKind;
  sourceName: string;
  externalRef: string | null;
}

/**
 * 來源的顯示名稱（#60 的 `## 決定` 2）：demo.json 的來源有目前語言的 `label` 時用它，否則用資料庫的 `name`。
 * 人在 demo 中新增的來源、或 repo 類省略 `label` 時照舊顯示 `name`。
 */
export function sourceLabel(sourceId: string, name: string, language: LanguageCode, index?: DemoTextIndex): string {
  return demoText("sourceName", sourceId, language, index) ?? name;
}

/** 交辦的參照：repo 類 `name#ref`；其他類型 `name ref`；沒有編號時只有來源名稱。 */
export function assignmentRef(ref: SourceRef, language: LanguageCode): string {
  const t = crewStrings("common", language);
  if (ref.externalRef === null) return fill(t.refSourceOnly, { name: ref.sourceName }, language);
  return fill(ref.sourceKind === "repo" ? t.refRepo : t.refOther, { name: ref.sourceName, ref: ref.externalRef }, language);
}

/** 工作（交件）的參照：repo 類 `PR #ref`；其他類型只有編號；沒有編號時是 null（畫面不顯示這一段）。 */
export function workRef(sourceKind: SourceKind, externalRef: string | null, language: LanguageCode): string | null {
  if (externalRef === null) return null;
  const t = crewStrings("common", language);
  return fill(sourceKind === "repo" ? t.refWorkRepo : t.refWorkOther, { ref: externalRef }, language);
}
