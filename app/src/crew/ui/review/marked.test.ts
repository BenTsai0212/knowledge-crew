// 重點標記的片段切分（#72 計畫第 4 點）
import { describe, expect, it } from "vitest";
import { parseWorkBody } from "../../work/body";
import { canMark, pointLocated, segments } from "./marked";

// 重點標記 〔N〕〔/N〕
const mark = (n: number, text: string) => `〔${n}〕${text}〔/${n}〕`;
const section = (content: string, points = 2) => parseWorkBody(`@@ reply/p2\n${content}`, points).sections[0];

describe("segments", () => {
  it("沒有標記：整段一個片段", () => {
    expect(segments("abc", [])).toEqual([{ text: "abc", point: null }]);
  });

  it("空字串：沒有片段", () => {
    expect(segments("", [])).toEqual([]);
  });

  it("標記在開頭、中間與結尾", () => {
    const s = section(`${mark(1, "AB")}cd${mark(2, "EF")}`);
    expect(segments(s.text, s.marks)).toEqual([
      { text: "AB", point: 1 },
      { text: "cd", point: null },
      { text: "EF", point: 2 },
    ]);
  });

  it("一段有兩個同編號的標記（貼文的內文）", () => {
    const s = section(`a${mark(1, "B")}c${mark(1, "D")}e`, 1);
    expect(segments(s.text, s.marks)).toEqual([
      { text: "a", point: null },
      { text: "B", point: 1 },
      { text: "c", point: null },
      { text: "D", point: 1 },
      { text: "e", point: null },
    ]);
  });

  it("跨行的內容保留換行，標記照原位置", () => {
    const s = section(`line 1\n${mark(1, "two")} line`);
    expect(segments(s.text, s.marks)).toEqual([
      { text: "line 1\n", point: null },
      { text: "two", point: 1 },
      { text: " line", point: null },
    ]);
  });

  it("標記的順序不照位置時先排序；超出範圍或重疊的略過", () => {
    expect(
      segments("abcdef", [
        { point: 2, start: 4, end: 6 },
        { point: 1, start: 0, end: 2 },
        { point: 3, start: 1, end: 3 },
        { point: 4, start: 5, end: 9 },
      ]),
    ).toEqual([
      { text: "ab", point: 1 },
      { text: "cd", point: null },
      { text: "ef", point: 2 },
    ]);
  });

  it("片段接起來就是原文", () => {
    const s = section(`x${mark(1, "y")}z\n${mark(2, "w")}`);
    expect(
      segments(s.text, s.marks)
        .map((p) => p.text)
        .join(""),
    ).toBe(s.text);
  });
});

describe("canMark／pointLocated", () => {
  it("有結構且沒有錯誤：可以標出", () => {
    const body = parseWorkBody(`@@ reply/p2\n${mark(1, "a")}\n@@ reply/closing [point 2]\nb`, 3);
    expect(canMark(body)).toBe(true);
    expect([0, 1, 2].map((i) => pointLocated(body, i))).toEqual([true, true, false]);
  });

  it("舊格式（沒有標頭行）：不標出", () => {
    const body = parseWorkBody("plain text", 1);
    expect(canMark(body)).toBe(false);
    expect(pointLocated(body, 0)).toBe(false);
  });

  it("解析有錯：不標出", () => {
    const body = parseWorkBody(`@@ reply/p2\n〔1〕a`, 1);
    expect(body.errors).not.toEqual([]);
    expect(canMark(body)).toBe(false);
    expect(pointLocated(body, 0)).toBe(false);
  });
});
