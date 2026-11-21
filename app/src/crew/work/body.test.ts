import { describe, expect, it } from "vitest";
import { parseWorkBody, toPlainText, type BodyErrorCode } from "./body";

const body = (...lines: string[]) => lines.join("\n");
/** 重點的一個行內位置（期望值） */
const at = (key: string, start: number, end: number) => ({ key, range: { start, end } });
const codes = (text: string, pointCount = 3): BodyErrorCode[] => parseWorkBody(text, pointCount).errors.map((e) => e.code);

describe("parseWorkBody：四種交件的結構（#65）", () => {
  it("回信：鍵、內容與去掉標記的文字", () => {
    const parsed = parseWorkBody(
      body(
        "@@ reply/to",
        "林小姐",
        "@@ reply/subject",
        "預購保溫瓶的到貨時間",
        "@@ reply/greeting",
        "林小姐您好，謝謝您的來信。",
        "@@ reply/p2",
        "您預購的保溫瓶預計在〔1〕12 月第 2 週〔/1〕到貨，出貨後會再寄送通知。",
        "@@ reply/closing",
        "運費部分，〔2〕單筆滿 NT$ 1,000 免運〔/2〕。如有其他問題歡迎再與我們聯繫。",
      ),
      2,
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => s.key)).toEqual(["reply/to", "reply/subject", "reply/greeting", "reply/p2", "reply/closing"]);
    expect(parsed.sections.every((s) => s.label === null)).toBe(true);
    const p2 = parsed.sections[3];
    expect(p2.text).toBe("您預購的保溫瓶預計在12 月第 2 週到貨，出貨後會再寄送通知。");
    expect(p2.text.slice(p2.marks[0].start, p2.marks[0].end)).toBe("12 月第 2 週");
    expect(parsed.points).toEqual([
      [at("reply/p2", 10, 19)],
      [at("reply/closing", 5, 21)],
    ]);
  });

  it("貼文：每個部分一個區塊，多行內容保留換行", () => {
    const parsed = parseWorkBody(body("@@ post/account", "範例生活", "@@ post/title", "冬季保溫瓶預購開跑", "@@ post/body", "第一行", "", "〔1〕限量 300 組〔/1〕", "@@ post/hashtags", "#保溫瓶 #預購"), 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => s.key)).toEqual(["post/account", "post/title", "post/body", "post/hashtags"]);
    expect(parsed.sections[2].text).toBe("第一行\n\n限量 300 組");
    expect(parsed.sections[3].text).toBe("#保溫瓶 #預購");
    expect(parsed.points[0]).toEqual([at("post/body", 5, 13)]);
  });

  it("知識庫條目：名稱、[required] 與空白欄位", () => {
    const parsed = parseWorkBody(
      body(
        "@@ kb/pre-orders | 預購商品",
        "@@ kb/pre-orders#owner [required] [point 1] | 負責部門",
        "電商營運組",
        "@@ kb/pre-orders#arrival | 到貨時間",
        "預購商品於〔2〕下單後 4 至 6 週〔/2〕到貨。",
        "@@ kb/pre-orders#effective-date [required] | 生效日期",
        "",
      ),
      2,
    );
    expect(parsed.errors).toEqual([]);
    const [entry, owner, arrival, effective] = parsed.sections;
    expect(entry).toMatchObject({ key: "kb/pre-orders", label: "預購商品", text: "" });
    expect(owner).toMatchObject({ label: "負責部門", text: "電商營運組", attrs: { required: true, change: null, points: [1] } });
    expect(arrival.attrs).toEqual({ required: false, change: null, points: [] });
    expect(effective).toMatchObject({ label: "生效日期", text: "", attrs: { required: true } });
    expect(parsed.points[0]).toEqual([{ key: "kb/pre-orders#owner" }]);
  });

  it("程式修改：檔案路徑當鍵、[added]／[modified] 與 PR 描述", () => {
    const parsed = parseWorkBody(body("@@ src/faq/FaqSearch.tsx [modified]", "搜尋改為忽略大小寫。", "@@ src/faq/normalize.ts [added] [point 1]", "新增比對用的正規化。", "@@ pr/description", "改善常見問題的搜尋。"), 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => [s.key, s.attrs.change])).toEqual([
      ["src/faq/FaqSearch.tsx", "modified"],
      ["src/faq/normalize.ts", "added"],
      ["pr/description", null],
    ]);
    expect(parsed.points[0]).toEqual([{ key: "src/faq/normalize.ts" }]);
  });

  it("區塊前後的空行去掉、中間的保留；\\r\\n 也可以", () => {
    const parsed = parseWorkBody("@@ post/body\r\n\r\n第一段\r\n\r\n第二段\r\n\r\n@@ post/title\r\n標題", 0);
    expect(parsed.sections.map((s) => s.text)).toEqual(["第一段\n\n第二段", "標題"]);
  });

  it("標頭行的空白與名稱的前後空白不影響結果", () => {
    const parsed = parseWorkBody("@@  kb/a#b  [required]   [point 1]  |  負責部門  \n內容", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections[0]).toMatchObject({ key: "kb/a#b", label: "負責部門", attrs: { required: true, points: [1] } });
  });
});

describe("parseWorkBody：重點的位置（#65）", () => {
  it("一段有兩個重點", () => {
    const parsed = parseWorkBody("@@ reply/p2\n〔1〕12 月第 2 週〔/1〕到貨，〔2〕免運〔/2〕。", 2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections[0].marks).toEqual([
      { point: 1, start: 0, end: 9 },
      { point: 2, start: 12, end: 14 },
    ]);
  });

  it("一個重點跨兩段：兩個區塊各標一次，依出現順序列出", () => {
    const parsed = parseWorkBody("@@ reply/p2\n預計〔1〕12 月〔/1〕到貨\n@@ reply/closing\n〔1〕出貨後通知〔/1〕", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.points[0]).toEqual([
      at("reply/p2", 2, 6),
      at("reply/closing", 0, 5),
    ]);
  });

  it("同一區塊同一個重點標兩處", () => {
    const parsed = parseWorkBody("@@ post/body\n〔1〕A〔/1〕 和 〔1〕B〔/1〕", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.points[0]).toHaveLength(2);
  });

  it("標記可以跨行，但不能跨區塊", () => {
    const parsed = parseWorkBody("@@ post/body\n〔1〕第一行\n第二行〔/1〕", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections[0].marks).toEqual([{ point: 1, start: 0, end: 7 }]);
    expect(codes("@@ reply/p1\n〔1〕到這裡\n@@ reply/p2\n結束〔/1〕", 1)).toEqual(["unclosed-mark", "unexpected-close"]);
  });

  it("整個欄位與行內標記並存（同一個重點）", () => {
    const parsed = parseWorkBody("@@ kb/x#owner [point 1] | 負責部門\n@@ kb/x#steps | 步驟\n先〔1〕通知負責部門〔/1〕", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.points[0]).toEqual([{ key: "kb/x#owner" }, at("kb/x#steps", 1, 7)]);
  });

  it("一個區塊是兩個重點；同一個 [point N] 寫兩次只算一次", () => {
    const parsed = parseWorkBody("@@ kb/x#owner [point 2] [point 1] [point 2]", 2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections[0].attrs.points).toEqual([1, 2]);
    expect(parsed.points).toEqual([[{ key: "kb/x#owner" }], [{ key: "kb/x#owner" }]]);
  });

  it("沒有標出的重點位置清單是空的；長度依重點數", () => {
    const parsed = parseWorkBody("@@ reply/p1\n〔1〕A〔/1〕", 3);
    expect(parsed.points).toEqual([[at("reply/p1", 0, 1)], [], []]);
  });

  it("一般的〔文字〕不是標記", () => {
    const parsed = parseWorkBody("@@ post/body\n〔限量〕預購〔一〕", 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections[0]).toMatchObject({ text: "〔限量〕預購〔一〕", marks: [] });
  });
});

describe("parseWorkBody：錯誤（#65）", () => {
  it("沒有關閉", () => {
    expect(parseWorkBody("@@ reply/p2\n〔1〕到貨", 1).errors).toEqual([{ code: "unclosed-mark", line: 2, key: "reply/p2", point: 1 }]);
  });

  it("關閉不符或沒有開頭", () => {
    expect(codes("@@ reply/p2\n〔1〕到貨〔/2〕")).toEqual(["unexpected-close"]);
    expect(codes("@@ reply/p2\n到貨〔/1〕")).toEqual(["unexpected-close"]);
  });

  it("重疊與巢狀", () => {
    expect(codes("@@ reply/p2\n〔1〕A〔2〕B〔/1〕C〔/2〕")).toEqual(["overlapping-mark"]);
    expect(codes("@@ reply/p2\n〔1〕A〔2〕B〔/2〕C〔/1〕")).toEqual(["overlapping-mark"]);
  });

  it("編號是 0、有前導 0 或超過重點數", () => {
    expect(codes("@@ reply/p2\n〔0〕A〔/0〕", 1)).toEqual(["invalid-point", "invalid-point"]);
    expect(codes("@@ reply/p2\n〔01〕A〔/01〕", 1)).toEqual(["invalid-point", "invalid-point"]);
    expect(codes("@@ reply/p2\n〔2〕A〔/2〕", 1)).toEqual(["invalid-point", "invalid-point"]);
    expect(codes("@@ kb/x#owner [point 2]", 1)).toEqual(["invalid-point"]);
    expect(codes("@@ kb/x#owner [point a]", 1)).toEqual(["invalid-point"]);
    expect(codes("@@ reply/p2\n〔1〕A〔/1〕", 0)).toEqual(["invalid-point", "invalid-point"]);
  });

  it("標記之間沒有文字", () => {
    expect(codes("@@ reply/p2\n〔1〕〔/1〕")).toEqual(["empty-mark"]);
  });

  it("重複的鍵", () => {
    expect(parseWorkBody("@@ reply/p2\nA\n@@ reply/p2\nB", 0).errors).toEqual([{ code: "duplicate-key", line: 3, key: "reply/p2" }]);
  });

  it("未知的屬性與互相衝突的屬性", () => {
    expect(codes("@@ reply/p2 [optional]")).toEqual(["unknown-attr"]);
    expect(codes("@@ src/a.ts [added] [modified]")).toEqual(["conflicting-attr"]);
  });

  it("標頭行的寫法不對：沒有鍵、屬性後還有文字", () => {
    expect(codes("@@\n內容")).toEqual(["invalid-header"]);
    expect(codes("@@ reply/p2 第二段")).toEqual(["invalid-header"]);
    const parsed = parseWorkBody("@@ reply/p1\nA\n@@ reply/p2 第二段\nB\n@@ reply/closing\nC", 0);
    expect(parsed.sections.map((s) => s.key)).toEqual(["reply/p1", "reply/closing"]);
  });

  it("第一個標頭行之前有內容", () => {
    expect(parseWorkBody("前言\n@@ reply/p2\nA", 0).errors).toEqual([{ code: "text-before-header", line: 1 }]);
    expect(codes("\n  \n@@ reply/p2\nA")).toEqual([]);
  });

  it("有錯誤時仍去掉標記，不合格的標記不列入位置", () => {
    const parsed = parseWorkBody("@@ reply/p2\n〔1〕到貨〔/1〕，〔3〕免運", 2);
    expect(parsed.errors.map((e) => e.code)).toEqual(["invalid-point", "unclosed-mark"]);
    expect(parsed.sections[0].text).toBe("到貨，免運");
    expect(parsed.points).toEqual([[at("reply/p2", 0, 2)], []]);
  });
});

describe("parseWorkBody：舊格式的退回（#65）", () => {
  it("沒有標頭行的全文原樣回傳，不處理〔N〕", () => {
    const old = "回覆保固期限為一年，附上申請方式。〔1〕請看「要看的重點」。〔/1〕";
    const parsed = parseWorkBody(old, 1);
    expect(parsed).toEqual({
      structured: false,
      sections: [{ key: null, label: null, attrs: { required: false, change: null, points: [] }, text: old, marks: [] }],
      points: [[]],
      errors: [],
    });
  });

  it("空字串", () => {
    const parsed = parseWorkBody("", 0);
    expect(parsed.structured).toBe(false);
    expect(parsed.sections[0].text).toBe("");
    expect(parsed.points).toEqual([]);
  });

  it("行中間的 @@ 不是標頭", () => {
    expect(parseWorkBody("差異見 @@ reply/p2", 0).structured).toBe(false);
  });
});

describe("toPlainText（#65）", () => {
  it("結構化：區塊之間空一行，去掉標頭、名稱與標記，略過空白區塊", () => {
    expect(toPlainText("@@ kb/x | 條目\n@@ kb/x#owner [required] | 負責部門\n〔1〕電商營運組〔/1〕\n@@ kb/x#date [required] | 生效日期\n@@ kb/x#steps | 步驟\n先通知\n再出貨")).toBe(
      "電商營運組\n\n先通知\n再出貨",
    );
  });

  it("舊格式原樣回傳", () => {
    expect(toPlainText("回覆保固期限為一年。")).toBe("回覆保固期限為一年。");
  });

  it("有錯誤時同樣去掉認得的標記", () => {
    expect(toPlainText("@@ reply/p2\n〔1〕到貨")).toBe("到貨");
  });
});
