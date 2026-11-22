// 驗收面板 v3 的交件本身與重點卡（#72 計畫第 4、7 點）：重點卡的位置、內容中的標記、已修改、變更一行、樣式
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "../../../client/i18n";
import { clientConfig } from "../../../client/load";
import { crewStrings } from "../../i18n";
import { parseWorkBody } from "../../work/body";
import { BodyView, PointList } from "./BodyView";
import panelCss from "../ReviewView.css?raw";

const language = clientConfig.client.defaultLanguage;
const t = crewStrings("review", language);
const html = (node: ReactNode) => renderToStaticMarkup(createElement("div", null, node));
const open = String.fromCodePoint(0x3014);
const close = String.fromCodePoint(0x3015);
const mark = (n: number, text: string) => `${open}${n}${close}${text}${open}/${n}${close}`;
const STRUCTURED = ["@@ reply/greeting", "Hello", "@@ reply/p2 [point 2]", `Arrives ${mark(1, "next week")}.`].join("\n");
const points = ["Dates", "Tone"];
const noop = () => {};

describe("重點卡", () => {
  it("每點一列，有編號與內容中的位置；不是按鈕（點選在之後的 PR）", () => {
    const out = html(createElement(PointList, { points, body: parseWorkBody(STRUCTURED, 2), language }));
    expect(out).toMatch(/^<div><ol /);
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out.match(/crew-review__point-place/g)).toHaveLength(2);
    expect(out).not.toContain("<button");
  });

  it("舊格式的全文：只列重點，不顯示位置", () => {
    const out = html(createElement(PointList, { points, body: parseWorkBody("one line summary", 2), language }));
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out).not.toContain("crew-review__point-place");
  });
});

describe("交件本身", () => {
  const view = (body: string, changes = { mode: "items" as const, items: [{ path: "reply/p2", summary: "Week" }] }) =>
    html(createElement(BodyView, { name: t.deliverableReply, body: parseWorkBody(body, 2), raw: body, changes, language }));

  it("詞句重點有底線的片段與上標編號；整個區塊的重點標在區塊上", () => {
    const out = view(STRUCTURED);
    expect(out).toContain(`aria-label="${t.deliverableReply}"`);
    expect(out).toMatch(/<span class="crew-review__mark" data-point="1">next week<sup class="crew-point-number" aria-hidden="true">1<\/sup>/);
    expect(out).toContain(`<span class="visually-hidden">${fill(t.pointMark, { n: 1 })}</span>`);
    expect(out).toMatch(/class="crew-review__block-text" data-point="2">/);
    expect(out).not.toContain("<mark");
  });

  it("有變更的區塊標「已修改」，底部一行列出變更", () => {
    const out = view(STRUCTURED);
    expect(out).toContain(fill(t.modified, { summary: "Week" }));
    expect(out).toContain("crew-review__changes-line");
  });

  it("舊格式或解析有錯：純文字，不畫標記", () => {
    for (const body of ["Plain old body", `@@ reply/p2\n${open}1${close}unclosed`]) {
      const out = view(body);
      expect(out).toContain('<p class="crew-review__body">');
      expect(out).not.toContain("crew-review__mark");
    }
  });

  it("少看：變更收成一行", () => {
    const out = view(STRUCTURED, { mode: "summary", count: 3 } as never);
    expect(out).toContain(fill(t.changesSummary, { count: 3 }, language));
    expect(out).not.toContain(fill(t.modified, { summary: "Week" }));
  });
});

describe("驗收面板的樣式", () => {
  const css = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string) => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";

  it("內容中的重點是 2px 墨色底線；整個區塊的重點是 2px 墨色左線", () => {
    expect(block(".crew-review__mark")).toContain("underline 2px var(--color-text)");
    expect(block(".crew-review__block-text[data-point]")).toContain("border-inline-start: 2px solid var(--color-text)");
  });

  it("「影響信任」是 danger 字；「確定退回」是墨色實心", () => {
    expect(block('.crew-review__impact[data-impact="trust"]')).toContain("color: var(--color-danger)");
    expect(block("button.crew-review__confirm")).toContain("background: var(--color-text)");
  });
});
