// 驗收面板的文案規則（#72 計畫第 2、4、5 點；#195 的少字版）：結論、交件的種類與問句、重點的位置。
import { describe, expect, it } from "vitest";
import { fill } from "../../../client/i18n";
import { clientConfig } from "../../../client/load";
import type { LanguageCode } from "../../../client/types";
import { DEMO } from "../../demo/load";
import type { WorkCheck } from "../../trust/types";
import { parseWorkBody } from "../../work/body";
import { crewStrings } from "../../i18n";
import { checkLabel, checkShort, positionLabel } from "../glossary";
import {
  decisionQuestion,
  deliverableName,
  deliverableOf,
  deliverableVerb,
  emptyRequiredFields,
  pointPlaces,
  verdictOf,
  type Deliverable,
} from "./conclusion";

const languages = [...clientConfig.client.languages] as LanguageCode[];
const KINDS: (Deliverable | null)[] = ["reply", "post", "kb", "code", null];

const REPLY = "@@ reply/p2\n預計〔1〕12 月〔/1〕到貨\n@@ reply/closing\n〔2〕免運〔/2〕";
const KB = "@@ kb/pre-orders | 預購商品說明\n@@ kb/pre-orders#owner [required] [point 1] | 負責部門\n電商營運組\n@@ kb/pre-orders#effective-date [required] | 生效日期";
const CODE = "@@ src/a.tsx [added]\n〔1〕a〔/1〕\n@@ pr/description\n- 〔2〕b〔/2〕";

type Ctx = Parameters<typeof verdictOf>[1];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  deliverable: "reply",
  body: parseWorkBody(REPLY, 2),
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

describe("交件的稱呼、動作與問句（#195）", () => {
  it("zh-TW", () => {
    expect(KINDS.map((d) => deliverableVerb(d, "zh-TW"))).toEqual(["寄出", "發布", "加進知識庫", "合併", "通過"]);
    expect(KINDS.map((d) => deliverableName(d, "zh-TW"))).toEqual(["回信草稿", "貼文草稿", "知識庫條目", "程式修改", "交件"]);
    expect(KINDS.map((d) => decisionQuestion(d, "zh-TW"))).toEqual(["可以寄出嗎？", "可以發布嗎？", "可以加進知識庫嗎？", "可以合併嗎？", "可以通過嗎？"]);
  });

  it.each(languages)("%s：每種都有文字，且彼此不同", (language) => {
    for (const fn of [deliverableName, decisionQuestion]) {
      const texts = KINDS.map((d) => fn(d, language));
      expect(texts.every((x) => x.trim() !== "")).toBe(true);
      expect(new Set(texts).size).toBe(KINDS.length);
    }
  });
});

describe("verdictOf：未通過", () => {
  it("一個未通過：「先別寄出：報價對不上」（第一個未通過檢查的簡短說明）", () => {
    const v = verdictOf([check("quote-match", "fail"), check("banned-words", "pass")], ctx())!;
    expect(v.tone).toBe("fail");
    expect(v.text).toBe("先別寄出：報價對不上");
    expect(checkShort("quote-match", "zh-TW")).toBe("報價對不上");
  });

  it("多個未通過：只寫第一個；同時有檢查中仍是未通過", () => {
    const v = verdictOf([check("links", "pending"), check("tone", "fail"), check("banned-words", "fail")], ctx({ deliverable: "post" }))!;
    expect(v.tone).toBe("fail");
    expect(v.text).toBe(`先別發布：${checkShort("tone", "zh-TW")}`);
    expect(v.text).not.toContain(checkShort("banned-words", "zh-TW")!);
  });

  it("條目的必填欄位未通過、內容有空白的必填欄位：寫出欄位名稱", () => {
    const v = verdictOf([check("required-fields", "fail"), check("format", "pass")], ctx({ deliverable: "kb", body: parseWorkBody(KB, 2) }))!;
    expect(v.text).toBe("先別加進知識庫：「生效日期」是空的");
  });

  it("必填欄位未通過、但內容看不出空白的欄位：用檢查的簡短說明", () => {
    const v = verdictOf([check("required-fields", "fail")], ctx({ deliverable: "kb" }))!;
    expect(v.text).toBe(`先別加進知識庫：${checkShort("required-fields", "zh-TW")}`);
  });

  it("程式修改：動作是「合併」", () => {
    expect(verdictOf([check("ci", "fail")], ctx({ deliverable: "code", body: parseWorkBody(CODE, 2) }))!.text).toBe("先別合併：測試沒通過");
  });

  it("其他工作類型：動作是「通過」", () => {
    expect(verdictOf([check("tone", "fail")], ctx({ deliverable: null }))!.text).toBe(`先別通過：${checkShort("tone", "zh-TW")}`);
  });

  it("沒有簡短說明的檢查：「{檢查名稱}未通過」（不認得的檢查名稱是代碼）", () => {
    expect(verdictOf([check("spellcheck", "fail")], ctx())!.text).toBe("先別寄出：spellcheck未通過");
    expect(checkShort("spellcheck", "zh-TW")).toBeNull();
  });

  it("不能驗收的身分：不用「先別…」", () => {
    const v = verdictOf([check("quote-match", "fail")], ctx({ audience: "view" }))!;
    expect(v.text).toBe("系統檢查未通過：報價對不上");
    expect(v.text).not.toContain("先別");
  });
});

describe("verdictOf：檢查中、都通過與不顯示", () => {
  it("沒有未通過、但有檢查中：warning 的「還在檢查」", () => {
    expect(verdictOf([check("length", "pass"), check("links", "pending")], ctx({ deliverable: "post" }))).toEqual({ tone: "pending", text: "還在檢查：連結" });
    expect(verdictOf([check("ci", "pending")], ctx({ audience: "view" }))!.text).toBe("還在檢查：自動測試");
  });

  it("都通過：「系統檢查都通過」", () => {
    expect(verdictOf([check("tone", "pass"), check("banned-words", "pass")], ctx())).toEqual({ tone: "pass", text: "系統檢查都通過" });
  });

  it("沒有檢查、已驗收：null", () => {
    expect(verdictOf([], ctx())).toBeNull();
    expect(verdictOf([check("tone", "fail")], ctx({ audience: "decided" }))).toBeNull();
  });

  it.each(languages)("%s：每種交件、每個檢查都代入完成", (language) => {
    const names = ["banned-words", "tone", "quote-match", "length", "links", "format", "required-fields", "duplicates", "ci"];
    for (const d of KINDS) {
      for (const audience of ["decide", "view"] as const) {
        for (const name of names) {
          for (const body of [parseWorkBody(KB, 2), parseWorkBody("plain", 2)]) {
            const v = verdictOf([check(name, "fail")], ctx({ deliverable: d, audience, language, body }))!;
            expect(v.text).not.toMatch(/[{}]/);
            expect(checkShort(name, language), name).not.toBeNull();
          }
        }
        expect(verdictOf([check("ci", "pending")], ctx({ deliverable: d, audience, language }))!.text).toContain(checkLabel("ci", language));
      }
    }
  });

  it("en：動作與原因", () => {
    const v = verdictOf([check("quote-match", "fail")], ctx({ language: "en" }))!;
    expect(v.text).toBe(fill(crewStrings("review", "en").verdictFail, { verb: "send", reason: checkShort("quote-match", "en")! }));
    expect(verdictOf([check("required-fields", "fail")], ctx({ language: "en", deliverable: "kb", body: parseWorkBody(KB, 2) }))!.text).toBe("Don’t add to the knowledge base yet: “生效日期” left empty");
    expect(verdictOf([check("tone", "pass")], ctx({ language: "en" }))!.text).toBe("All system checks passed");
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
