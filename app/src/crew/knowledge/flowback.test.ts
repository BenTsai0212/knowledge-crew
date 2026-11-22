// 交件全文 → 回流文件的轉換（#92）。全文用 demo.json 的實際內容，另以小例子測退回的情況。
import { describe, expect, it } from "vitest";
import { DEMO_RAW } from "../demo/load";
import type { DemoFile } from "../demo/types";
import { flowbackDocumentId, toFlowbackDocument } from "./flowback";

const OPEN = String.fromCodePoint(0x3014);
const CLOSE = String.fromCodePoint(0x3015);
const mark = (n: number, text: string) => `${OPEN}${n}${CLOSE}${text}${OPEN}/${n}${CLOSE}`;

const demo = DEMO_RAW as DemoFile;
const bodyOf = (assignmentId: string, language: "zh-TW" | "en") =>
  demo.assignments.find((a) => a.id === assignmentId)!.works[0].body[language];

describe("toFlowbackDocument()", () => {
  it("條目名稱是標題；每個非空白的欄位一段（名稱、換行、內容），依出現順序", () => {
    const body = [
      "@@ kb/returns | Returns",
      "@@ kb/returns#owner [required] [point 1] | Owner",
      "Customer care",
      "@@ kb/returns#window | Window",
      `Returns are accepted ${mark(2, "within 14 days")}.`,
      "Bring the receipt.",
    ].join("\n");
    expect(toFlowbackDocument(body)).toEqual({
      title: "Returns",
      passages: ["Owner\nCustomer care", "Window\nReturns are accepted within 14 days.\nBring the receipt."],
    });
  });

  it("空白欄位（含空白的必填欄位）不寫；條目本身有說明時是第一段；欄位沒有名稱時只有內容", () => {
    const body = ["@@ kb/returns", "How returns work.", "@@ kb/returns#owner [required] | Owner", "", "@@ kb/returns#note", "Ask first."].join("\n");
    expect(toFlowbackDocument(body)).toEqual({ title: "returns", passages: ["How returns work.", "Ask first."] });
  });

  it("demo.json 的 k13（待驗收）：空白的生效日不寫，重點標記去掉", () => {
    const doc = toFlowbackDocument(bodyOf("k13", "zh-TW"))!;
    expect(doc.title).toBe("預購商品說明");
    expect(doc.passages[0]).toBe("負責部門\n電商營運組");
    expect(doc.passages.some((p) => p.includes(OPEN) || p.includes(CLOSE))).toBe(false);
    expect(doc.passages.some((p) => p.startsWith("生效日"))).toBe(false);
    const en = toFlowbackDocument(bodyOf("k13", "en"))!;
    expect(en.title).toBe("Pre-order items");
    expect(en.passages).toHaveLength(doc.passages.length);
  });

  it("demo.json 的 k12（已通過）是結構化全文；k01～k11 的一行摘要不回流", () => {
    expect(toFlowbackDocument(bodyOf("k12", "zh-TW"))?.passages[0]).toBe("負責部門\n採購組");
    for (const id of ["k01", "k05", "k11"]) expect(toFlowbackDocument(bodyOf(id, "zh-TW"))).toBeNull();
  });

  it("不是恰好一個知識庫條目時不回流", () => {
    // 舊格式、格式有錯、沒有條目、兩個條目、混入其他條目的欄位或其他交件的區塊、沒有任何內容
    const cases = [
      "A one-line summary.",
      "before\n@@ kb/a | A\n@@ kb/a#x | X\nx",
      "@@ kb/a#x | X\nx",
      "@@ kb/a | A\n@@ kb/a#x | X\nx\n@@ kb/b | B\n@@ kb/b#y | Y\ny",
      "@@ kb/a | A\n@@ kb/b#x | X\nx",
      "@@ kb/a | A\n@@ reply/p1\nHello",
      "@@ kb/a | A\n@@ kb/a#x [required] | X\n",
    ];
    for (const body of cases) expect(toFlowbackDocument(body), body).toBeNull();
  });

  it("文件 id 是 crew-<工作 id>", () => {
    expect(flowbackDocumentId("k13-w1")).toBe("crew-k13-w1");
  });
});
