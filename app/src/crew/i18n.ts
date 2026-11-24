// crew 介面文字的讀取模組：選定客戶的 i18n/crew/<畫面>.<語言>.json（@client 別名）在 build 時讀入（#15 的決定：選項 B）。
// knowledge-kit 的翻譯檔（client/i18n/<語言>.json）與讀取模組（app/src/client/i18n.ts）不改；
// 一個畫面一份，新增畫面時加翻譯檔並在 CrewScreenKeys 加一行。鍵與參數由 i18n.test.ts 檢查，執行時不驗證。
// 帶參數的文字用 app/src/client/i18n.ts 的 fill() 代入（同一套 {key} 與單複數寫法）。
import type { LanguageCode } from "../client/types";

// 畫面 → 鍵（以 zh-TW 的翻譯檔為準；各語言的鍵相同由測試保證）
export type CrewScreenKeys = {
  common: keyof typeof import("@client/i18n/crew/common.zh-TW.json");
  ledger: keyof typeof import("@client/i18n/crew/ledger.zh-TW.json");
  home: keyof typeof import("@client/i18n/crew/home.zh-TW.json");
  assign: keyof typeof import("@client/i18n/crew/assign.zh-TW.json");
  employees: keyof typeof import("@client/i18n/crew/employees.zh-TW.json");
  trust: keyof typeof import("@client/i18n/crew/trust.zh-TW.json");
  review: keyof typeof import("@client/i18n/crew/review.zh-TW.json");
  glossary: keyof typeof import("@client/i18n/crew/glossary.zh-TW.json");
  knowledge: keyof typeof import("@client/i18n/crew/knowledge.zh-TW.json");
  tour: keyof typeof import("@client/i18n/crew/tour.zh-TW.json");
  overview: keyof typeof import("@client/i18n/crew/overview.zh-TW.json");
};
export type CrewScreen = keyof CrewScreenKeys;
export type CrewTexts<S extends CrewScreen> = Readonly<Record<CrewScreenKeys[S], string>>;

const files = import.meta.glob<Record<string, string>>("@client/i18n/crew/*.json", { eager: true, import: "default" });

// 檔名（<畫面>.<語言>，不含 .json）→ 畫面 → 語言 → 介面文字
export const CREW_TRANSLATIONS: Readonly<Record<string, Readonly<Record<LanguageCode, Readonly<Record<string, string>>>>>> = (() => {
  const out: Record<string, Record<LanguageCode, Record<string, string>>> = {};
  for (const [path, texts] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf("/") + 1, -".json".length);
    const dot = name.indexOf(".");
    if (dot <= 0) throw new Error(`Crew UI strings file name must be <screen>.<language>.json: ${path}`);
    const screen = name.slice(0, dot);
    (Object.hasOwn(out, screen) ? out[screen] : (out[screen] = {}))[name.slice(dot + 1)] = texts;
  }
  return out;
})();

// 沒有的畫面或語言拋錯（與 app/src/client/i18n.ts 的 strings() 相同）
export function crewStrings<S extends CrewScreen>(screen: S, language: LanguageCode): CrewTexts<S> {
  if (!Object.hasOwn(CREW_TRANSLATIONS, screen)) throw new Error(`No crew UI strings for screen: ${screen}`);
  const byLanguage = CREW_TRANSLATIONS[screen];
  if (!Object.hasOwn(byLanguage, language)) throw new Error(`No crew UI strings for screen ${screen} in language: ${language}`);
  return byLanguage[language] as CrewTexts<S>;
}
