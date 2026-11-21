// 自動檢查與變更位置的白話名稱（#63，設計規格 v3 第 7 節）：文字在 client/i18n/crew/glossary.<語言>.json。
// 沿用 labels.ts 的寫法：翻譯檔沒有對應的鍵時顯示代碼本身。
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { CheckStatus } from "../trust/types";
import { crewStrings } from "../i18n";

// 代碼 → 鍵的片段：以 - 分開的每段首字大寫（quote-match → QuoteMatch）
const camel = (code: string) =>
  code
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

function lookup(key: string, language: LanguageCode): string | null {
  const texts: Readonly<Record<string, string>> = crewStrings("glossary", language);
  return Object.hasOwn(texts, key) ? texts[key] : null;
}

/** 自動檢查的名稱；沒有對應時顯示代碼本身。 */
export function checkLabel(name: string, language: LanguageCode): string {
  return lookup(`check${camel(name)}`, language) ?? name;
}

/** 自動檢查通過或未通過時的一句說明；檢查中、或沒有對應時是 null。 */
export function checkSentence(name: string, result: CheckStatus, language: LanguageCode): string | null {
  if (result === "pending") return null;
  return lookup(`check${camel(name)}${result === "pass" ? "Pass" : "Fail"}`, language);
}

/** `reply/*`、`post/*`、`kb/*` 以外的位置（程式檔案路徑）：畫面以等寬字顯示。 */
export const isCodePosition = (position: string) => !/^(reply|post|kb)\//.test(position);

/**
 * 變更位置的白話：`reply/*`、`post/*` 依翻譯檔；`kb/<條目>` → 條目名稱，`kb/<條目>#<欄位>` → 條目名稱與欄位名稱。
 * 程式檔案路徑、或任一部分沒有對應時，原樣回傳。
 */
export function positionLabel(position: string, language: LanguageCode): string {
  const slash = position.indexOf("/");
  const kind = position.slice(0, slash);
  const rest = position.slice(slash + 1);
  if (slash <= 0 || rest === "") return position;
  if (kind === "reply" || kind === "post") return lookup(`position${camel(kind)}${camel(rest)}`, language) ?? position;
  if (kind !== "kb") return position;
  const hash = rest.indexOf("#");
  const entry = lookup(`kb${camel(hash < 0 ? rest : rest.slice(0, hash))}`, language);
  if (entry === null) return position;
  const t = crewStrings("glossary", language);
  if (hash < 0) return fill(t.kbEntry, { entry });
  const field = lookup(`field${camel(rest.slice(hash + 1))}`, language);
  return field === null ? position : fill(t.kbField, { entry, field });
}
