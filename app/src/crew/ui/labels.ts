// crew 各畫面共用的名稱（#34）：工作類型的名稱在 client/i18n/crew/common.<語言>.json（workType<Id>）。
import type { LanguageCode } from "../../client/types";
import { crewStrings } from "../i18n";

/** 工作類型名稱；翻譯檔沒有對應的鍵時顯示 id 本身。 */
export function workTypeLabel(workTypeId: string, language: LanguageCode): string {
  const texts: Readonly<Record<string, string>> = crewStrings("common", language);
  const key = `workType${workTypeId.charAt(0).toUpperCase()}${workTypeId.slice(1)}`;
  return Object.hasOwn(texts, key) ? texts[key] : workTypeId;
}
