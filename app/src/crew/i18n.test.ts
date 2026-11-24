import { describe, expect, it } from "vitest";
import { fill } from "../client/i18n";
import { clientConfig } from "../client/load";
import { CREW_TRANSLATIONS, crewStrings, type CrewScreen } from "./i18n";

const languages = [...clientConfig.client.languages].sort();
const screens = Object.keys(CREW_TRANSLATIONS) as CrewScreen[];

// 文字中的參數：{name}，或單複數寫法 {name, plural, …} 的 name（與 app/src/client/i18n.ts 的 fill() 相同的寫法）
const params = (text: string) => [...new Set([...text.matchAll(/\{([A-Za-z]+)(?:\}|, plural,)/g)].map((m) => m[1]))].sort();

describe("crew 的翻譯檔（client/i18n/crew/）", () => {
  it("至少有首頁的「今天的工作」", () => {
    expect(screens).toContain("home");
  });

  it("每個畫面的語言與 client.json 的 languages 一致", () => {
    for (const screen of screens) expect(Object.keys(CREW_TRANSLATIONS[screen]).sort(), screen).toEqual(languages);
  });

  it("同一畫面每種語言的鍵相同，值都是非空字串", () => {
    for (const screen of screens) {
      const [base, ...rest] = languages;
      const keys = Object.keys(CREW_TRANSLATIONS[screen][base]).sort();
      expect(keys.length, screen).toBeGreaterThan(0);
      for (const language of rest) expect(Object.keys(CREW_TRANSLATIONS[screen][language]).sort(), `${screen}.${language}`).toEqual(keys);
      for (const language of languages) {
        const bad = Object.entries(CREW_TRANSLATIONS[screen][language]).filter(([, v]) => typeof v !== "string" || v.trim() === "");
        expect(bad, `${screen}.${language}`).toEqual([]);
      }
    }
  });

  it("同一個鍵在每種語言的 {參數} 相同，代入後沒有殘留的大括號", () => {
    for (const screen of screens) {
      const [base] = languages;
      for (const key of Object.keys(CREW_TRANSLATIONS[screen][base])) {
        const expected = params(CREW_TRANSLATIONS[screen][base][key]);
        for (const language of languages) {
          const text = CREW_TRANSLATIONS[screen][language][key];
          expect(params(text), `${screen}.${language}.${key}`).toEqual(expected);
          const values = Object.fromEntries(expected.map((p) => [p, 2]));
          expect(fill(text, values, language), `${screen}.${language}.${key}`).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it("params 認得一般參數與單複數寫法，# 不算參數", () => {
    expect(params("{employee} has {count, plural, one {# item} other {# items}} ({count})")).toEqual(["count", "employee"]);
    expect(params("no params")).toEqual([]);
  });
});

describe("審查程度的用詞（#128）", () => {
  // 「少看」改稱「看重點」、「Lighter review」改稱「Review key points」；避免之後又寫回舊用詞
  const old: Record<string, RegExp> = { "zh-TW": /少看/, en: /lighter/i };

  it("zh-TW 不含「少看」、en 不含「lighter」（大小寫不分）", () => {
    for (const [language, pattern] of Object.entries(old)) {
      const hits = screens
        .filter((screen) => CREW_TRANSLATIONS[screen][language])
        .flatMap((screen) => Object.entries(CREW_TRANSLATIONS[screen][language]).filter(([, v]) => pattern.test(v)).map(([k]) => `${screen}.${k}`));
      expect(hits, language).toEqual([]);
    }
  });

  it("層級成對：看重點／逐項看、Review key points／Review every item", () => {
    for (const screen of ["review", "trust", "employees", "assign"] as CrewScreen[]) {
      if (CREW_TRANSLATIONS[screen]["zh-TW"]) {
        expect(CREW_TRANSLATIONS[screen]["zh-TW"].levelLight, screen).toBe("看重點");
        expect(CREW_TRANSLATIONS[screen]["zh-TW"].levelItem, screen).toBe("逐項看");
      }
      if (CREW_TRANSLATIONS[screen].en) {
        expect(CREW_TRANSLATIONS[screen].en.levelLight, screen).toBe("Review key points");
        expect(CREW_TRANSLATIONS[screen].en.levelItem, screen).toBe("Review every item");
      }
    }
  });
});

describe("crewStrings", () => {
  it("每個畫面與語言都回傳該檔的文字", () => {
    for (const screen of screens) {
      for (const language of languages) expect(crewStrings(screen, language)).toBe(CREW_TRANSLATIONS[screen][language]);
    }
    expect(crewStrings("home", "zh-TW").groupInProgress).toBe("進行中");
    expect(crewStrings("home", "en").groupInProgress).toBe("In progress");
  });

  it("沒有的畫面或語言拋錯（與 knowledge-kit 的 strings() 相同）", () => {
    expect(() => crewStrings("home", "ja")).toThrow("No crew UI strings for screen home in language: ja");
    expect(() => crewStrings("home", "toString")).toThrow("No crew UI strings");
    expect(() => crewStrings("nope" as CrewScreen, "en")).toThrow("No crew UI strings for screen: nope");
    expect(() => crewStrings("toString" as CrewScreen, "en")).toThrow("No crew UI strings for screen: toString");
  });
});
