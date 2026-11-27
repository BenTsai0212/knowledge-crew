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

describe("審查方式的用詞（#128、#186）", () => {
  // ADR 0009：「逐項看／看重點」改稱「全部看／只看標記處」，「信任」改稱「審查方式」，「工作帳本」改稱「紀錄」；
  // #128 的「少看」「Lighter review」也不再使用。避免之後又寫回舊用詞
  const old: Record<string, RegExp[]> = {
    "zh-TW": [/少看/, /逐項看/, /看重點/, /工作帳本/, /信任/],
    // 「Trust」只禁大寫開頭的功能名寫法
    en: [/lighter/i, /Review every item/i, /Review key points/i, /\bTrust\b/],
  };

  it("crew 的中英字串不含舊用詞", () => {
    for (const [language, patterns] of Object.entries(old)) {
      const hits = screens
        .filter((screen) => CREW_TRANSLATIONS[screen][language])
        .flatMap((screen) =>
          Object.entries(CREW_TRANSLATIONS[screen][language])
            .filter(([, v]) => patterns.some((pattern) => pattern.test(v)))
            .map(([k]) => `${screen}.${k}`),
        );
      expect(hits, language).toEqual([]);
    }
  });

  it("檢查本身認得舊用詞", () => {
    expect(old["zh-TW"].some((p) => p.test("這次逐項看"))).toBe(true);
    expect(old["zh-TW"].some((p) => p.test("看信任紀錄"))).toBe(true);
    expect(old.en.some((p) => p.test("See the record in Trust"))).toBe(true);
    expect(old.en.some((p) => p.test("Review mode"))).toBe(false);
  });

  it("審查方式成對：只看標記處／全部看、Check marked spots／Check everything", () => {
    for (const screen of ["review", "trust", "employees", "assign"] as CrewScreen[]) {
      if (CREW_TRANSLATIONS[screen]["zh-TW"]) {
        expect(CREW_TRANSLATIONS[screen]["zh-TW"].levelLight, screen).toBe("只看標記處");
        expect(CREW_TRANSLATIONS[screen]["zh-TW"].levelItem, screen).toBe("全部看");
      }
      if (CREW_TRANSLATIONS[screen].en) {
        expect(CREW_TRANSLATIONS[screen].en.levelLight, screen).toBe("Check marked spots");
        expect(CREW_TRANSLATIONS[screen].en.levelItem, screen).toBe("Check everything");
      }
    }
  });

  it("子頁名稱：工作、員工、交辦、紀錄（#191）；清單｜看板、看統計｜看事件", () => {
    expect(CREW_TRANSLATIONS.common["zh-TW"]).toMatchObject({ sectionWorks: "工作", sectionEmployees: "員工", sectionAssignments: "交辦", sectionRecords: "紀錄" });
    expect(CREW_TRANSLATIONS.common.en).toMatchObject({ sectionWorks: "Work", sectionEmployees: "Employees", sectionAssignments: "Assign", sectionRecords: "Records" });
    expect(CREW_TRANSLATIONS.common["zh-TW"]).toMatchObject({ viewList: "清單", viewBoard: "看板", viewStats: "看統計", viewEvents: "看事件" });
    expect(CREW_TRANSLATIONS.common.en).toMatchObject({ viewList: "List", viewBoard: "Board", viewStats: "View statistics", viewEvents: "View events" });
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

// #153 附錄 A：新增的字串照 Issue 原文（中英文都要有）；reportOpenLedger 已沒有使用而刪除；#186 換用詞（工作帳本 → 紀錄）
describe("可近用性的字串（#153 附錄 A）", () => {
  const APPENDIX_A: [CrewScreen, string, string, string][] = [
    ["review", "confirmReturnHint", "先選一個退回原因。", "Choose a reason first."],
    ["trust", "reportOpenLedgerHidden", "（在紀錄查看）", "(show in the records)"],
    ["trust", "historyLabel", "{employee} 的「{workType}」：建議的經過", "{employee} · “{workType}”: how the suggestion went"],
    ["employees", "guidelinesLabel", "{employee} 的守則", "{employee}’s guidelines"],
    ["overview", "projectGuidelines", "守則 {count} 條", "{count, plural, one {# guideline} other {# guidelines}}"],
  ];

  it("逐字相同", () => {
    for (const [screen, key, zh, en] of APPENDIX_A) {
      expect((crewStrings(screen, "zh-TW") as Record<string, string>)[key], `${screen}.${key}`).toBe(zh);
      expect((crewStrings(screen, "en") as Record<string, string>)[key], `${screen}.${key}`).toBe(en);
    }
  });

  it("reportOpenLedger 已刪除", () => {
    for (const language of ["zh-TW", "en"]) expect(Object.keys(crewStrings("trust", language))).not.toContain("reportOpenLedger");
  });
});
