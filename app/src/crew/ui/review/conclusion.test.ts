// 驗收面板 v3 的文案規則（#72 計畫第 2、4、5 點）：結論列、交件的種類與問句、重點的位置。
import { describe, expect, it } from "vitest";
import { fill } from "../../../client/i18n";
import { clientConfig } from "../../../client/load";
import type { LanguageCode } from "../../../client/types";
import { DEMO } from "../../demo/load";
import type { WorkCheck } from "../../trust/types";
import { parseWorkBody } from "../../work/body";
import { crewStrings } from "../../i18n";
import { checkLabel, checkSentence, positionLabel } from "../glossary";
import {
  conclusionOf,
  decisionQuestion,
  deliverableName,
  deliverableOf,
  deliverableVerb,
  emptyRequiredFields,
  pointPlaces,
  type ConclusionContext,
  type Deliverable,
} from "./conclusion";

const languages = [...clientConfig.client.languages] as LanguageCode[];
const KINDS: (Deliverable | null)[] = ["reply", "post", "kb", "code", null];

const REPLY = "@@ reply/p2\n預計〔1〕12 月〔/1〕到貨\n@@ reply/closing\n〔2〕免運〔/2〕";
const KB = "@@ kb/pre-orders | 預購商品說明\n@@ kb/pre-orders#owner [required] [point 1] | 負責部門\n電商營運組\n@@ kb/pre-orders#effective-date [required] | 生效日期";
const CODE = "@@ src/a.tsx [added]\n〔1〕a〔/1〕\n@@ pr/description\n- 〔2〕b〔/2〕";

const ctx = (over: Partial<ConclusionContext> = {}): ConclusionContext => ({
  deliverable: "reply",
  body: parseWorkBody(REPLY, 2),
  pointCount: 2,
  audience: "decide",
  language: "zh-TW",
  ...over,
});
const check = (name: string, status: WorkCheck["status"]): WorkCheck => ({ name, status });

describe("deliverableOf", () => {
  it("工作類型 → 交件的種類；其他是 null", () => {
    expect(["support", "content", "knowledge", "dev", "ops"].map(deliverableOf)).toEqual(["reply", "post", "kb", "code", null]);
    expect(deliverableOf("toString")).toBeNull();
  });
});

describe("交件的稱呼、動詞與問句（規格第 7 節）", () => {
  it("zh-TW", () => {
    expect(KINDS.map((d) => deliverableVerb(d, "zh-TW"))).toEqual(["寄出", "貼出", "加進知識庫", "通過", "通過"]);
    expect(KINDS.map((d) => deliverableName(d, "zh-TW"))).toEqual(["回信草稿", "貼文草稿", "知識庫條目", "程式修改", "交件"]);
    expect(KINDS.map((d) => decisionQuestion(d, "zh-TW"))).toEqual([
      "這封信可以寄出嗎？",
      "這篇可以貼出嗎？",
      "這則條目可以加進知識庫嗎？",
      "這份修改可以通過嗎？",
      "這件工作可以通過嗎？",
    ]);
  });

  it.each(languages)("%s：每種都有文字，且彼此不同", (language) => {
    for (const fn of [deliverableName, decisionQuestion]) {
      const texts = KINDS.map((d) => fn(d, language));
      expect(texts.every((x) => x.trim() !== "")).toBe(true);
      expect(new Set(texts).size).toBe(KINDS.length);
    }
  });
});

describe("conclusionOf：未通過", () => {
  it("一個未通過：「先別寄出：報價核對沒有通過」，說明是未通過的一句＋重點已用編號標出", () => {
    const c = conclusionOf([check("quote-match", "fail"), check("banned-words", "pass")], ctx())!;
    expect(c.tone).toBe("fail");
    expect(c.title).toBe("先別寄出：報價核對沒有通過");
    expect(c.description).toBe(`${checkSentence("quote-match", "fail", "zh-TW")}。{employee} 標了 2 個重點，已在回信草稿裡用編號標出。`);
  });

  it("多個未通過：名稱以「、」連接，說明用第一個；同時有檢查中仍是未通過", () => {
    const c = conclusionOf([check("tone", "fail"), check("links", "pending"), check("banned-words", "fail")], ctx({ deliverable: "post" }))!;
    expect(c.tone).toBe("fail");
    expect(c.title).toBe("先別貼出：語氣、禁用詞沒有通過");
    expect(c.description.startsWith(checkSentence("tone", "fail", "zh-TW")!)).toBe(true);
  });

  it("條目的必填欄位未通過、內容有空白的必填欄位：說明先講空白的欄位", () => {
    const c = conclusionOf([check("required-fields", "fail"), check("format", "pass")], ctx({ deliverable: "kb", body: parseWorkBody(KB, 2), pointCount: 2 }))!;
    expect(c.title).toBe("先別加進知識庫：必填欄位沒有通過");
    // 第 2 個重點沒有位置：改說列在重點卡
    expect(c.description).toBe("「生效日期」是空的。{employee} 標了 2 個重點，列在「要看的重點」。");
  });

  it("必填欄位未通過、但內容看不出空白的欄位：用檢查的一句", () => {
    const c = conclusionOf([check("required-fields", "fail")], ctx({ deliverable: "kb" }))!;
    expect(c.description.startsWith(checkSentence("required-fields", "fail", "zh-TW")!)).toBe(true);
  });

  it("程式修改：動詞是「通過」", () => {
    expect(conclusionOf([check("ci", "fail")], ctx({ deliverable: "code", body: parseWorkBody(CODE, 2) }))!.title).toBe("先別通過：自動測試沒有通過");
  });

  it("舊格式或解析有錯：重點列在重點卡", () => {
    for (const body of [parseWorkBody("plain", 2), parseWorkBody("@@ reply/p2\n〔1〕a", 2)]) {
      expect(conclusionOf([check("tone", "fail")], ctx({ body }))!.description).toContain("列在「要看的重點」");
    }
  });

  it("沒有重點", () => {
    const c = conclusionOf([check("tone", "fail")], ctx({ body: parseWorkBody("@@ reply/p2\na", 0), pointCount: 0 }))!;
    expect(c.description).toBe(`${checkSentence("tone", "fail", "zh-TW")}。{employee} 沒有標出要看的重點。`);
  });

  it("不認得的檢查：名稱是代碼，說明只有重點的一句", () => {
    const c = conclusionOf([check("spellcheck", "fail")], ctx())!;
    expect(c.title).toBe("先別寄出：spellcheck沒有通過");
    expect(c.description).toBe("{employee} 標了 2 個重點，已在回信草稿裡用編號標出。");
  });

  it("不能驗收的身分：不用「先別…」", () => {
    const c = conclusionOf([check("quote-match", "fail")], ctx({ audience: "view" }))!;
    expect(c.title).toBe("報價核對沒有通過");
    expect(c.title).not.toContain("先別");
  });
});

describe("conclusionOf：檢查中與不顯示", () => {
  it("沒有未通過、但有檢查中：warning 的「還在檢查」", () => {
    const c = conclusionOf([check("length", "pass"), check("links", "pending")], ctx({ deliverable: "post" }))!;
    expect(c).toEqual({ tone: "pending", title: "還在檢查：連結", description: crewStrings("review", "zh-TW").conclusionPendingNote });
    expect(conclusionOf([check("ci", "pending")], ctx({ audience: "view" }))!.title).toBe("還在檢查：自動測試");
  });

  it("全部通過、沒有檢查、已驗收：null", () => {
    expect(conclusionOf([check("tone", "pass")], ctx())).toBeNull();
    expect(conclusionOf([], ctx())).toBeNull();
    expect(conclusionOf([check("tone", "fail")], ctx({ audience: "decided" }))).toBeNull();
  });

  it.each(languages)("%s：標題與說明都代入完成（只留 {employee}）", (language) => {
    for (const d of KINDS) {
      for (const checks of [[check("required-fields", "fail")], [check("ci", "pending")]]) {
        for (const audience of ["decide", "view"] as const) {
          for (const body of [parseWorkBody(KB, 2), parseWorkBody("plain", 2)]) {
            const c = conclusionOf(checks, ctx({ deliverable: d, audience, language, body }))!;
            expect(c.title).not.toMatch(/[{}]/);
            expect(c.title).toContain(checkLabel(checks[0].name, language));
            expect(c.description.replace("{employee}", "")).not.toMatch(/[{}]/);
          }
        }
      }
    }
  });

  it("en：單複數與動詞", () => {
    const c = conclusionOf([check("quote-match", "fail")], ctx({ language: "en" }))!;
    expect(c.title).toBe(fill(crewStrings("review", "en").conclusionFail, { verb: "send", checks: checkLabel("quote-match", "en") }));
    expect(c.description).toContain("marked 2 points");
    expect(conclusionOf([check("tone", "fail")], ctx({ language: "en", body: parseWorkBody("@@ reply/p2\n〔1〕a〔/1〕", 1), pointCount: 1 }))!.description).toContain("marked 1 point,");
  });
});

describe("emptyRequiredFields", () => {
  it("只列必填且空白的欄位；舊格式沒有", () => {
    expect(emptyRequiredFields(parseWorkBody(KB, 2), "zh-TW")).toEqual(["生效日期"]);
    expect(emptyRequiredFields(parseWorkBody("@@ kb/pre-orders#owner [required]\n", 0), "zh-TW")).toEqual(["「預購商品說明」的「負責部門」"]);
    expect(emptyRequiredFields(parseWorkBody("", 0), "zh-TW")).toEqual([]);
  });
});

describe("pointPlaces", () => {
  it("回信：段落名稱", () => {
    expect(pointPlaces(parseWorkBody(REPLY, 2), "zh-TW")).toEqual([[{ text: "第 2 段", code: false }], [{ text: "結尾", code: false }]]);
  });

  it("條目：「名稱」欄位；沒有位置的重點是空的", () => {
    expect(pointPlaces(parseWorkBody(KB, 2), "zh-TW")).toEqual([[{ text: "「負責部門」欄位", code: false }], []]);
  });

  it("程式：檔案路徑（等寬）與「PR 描述」", () => {
    expect(pointPlaces(parseWorkBody(CODE, 2), "zh-TW")).toEqual([[{ text: "src/a.tsx", code: true }], [{ text: "PR 描述", code: false }]]);
  });

  it("同一個區塊有兩個標記只列一次；不同區塊依出現順序", () => {
    const body = parseWorkBody("@@ post/title\n〔1〕a〔/1〕\n@@ post/body\n〔1〕b〔/1〕c〔1〕d〔/1〕", 1);
    expect(pointPlaces(body, "zh-TW")).toEqual([[{ text: "標題", code: false }, { text: "內文", code: false }]]);
  });

  it("不能標出（舊格式、解析有錯）：每個重點都沒有位置", () => {
    expect(pointPlaces(parseWorkBody("plain", 2), "zh-TW")).toEqual([[], []]);
    expect(pointPlaces(parseWorkBody("@@ reply/p2\n〔1〕a", 2), "zh-TW")).toEqual([[], []]);
  });
});

describe("完整性：demo.json 的交件，重點的位置與段落名稱都有白話", () => {
  const works = (DEMO?.assignments ?? []).flatMap((a) => a.works);

  it.each(languages)("%s", (language) => {
    let checked = 0;
    for (const w of works) {
      const body = parseWorkBody(w.body[language], w.points.length);
      if (!body.structured) continue;
      for (const places of pointPlaces(body, language)) {
        for (const p of places) {
          expect(p.text, w.body[language]).not.toMatch(/^(reply|post|kb|pr)\//);
          checked++;
        }
      }
      for (const s of body.sections) {
        // 回信與貼文的段落名稱（左側欄）
        if (s.key && /^(reply|post)\//.test(s.key)) expect(positionLabel(s.key, language), s.key).not.toBe(s.key);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
