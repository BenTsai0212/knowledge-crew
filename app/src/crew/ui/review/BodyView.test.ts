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
  it("每點一列，有編號與內容中的位置；沒有 onToggle 時不是按鈕", () => {
    const out = html(createElement(PointList, { points, body: parseWorkBody(STRUCTURED, 2), language }));
    expect(out).toMatch(/^<div><ol /);
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out.match(/crew-review__point-place/g)).toHaveLength(2);
    expect(out).not.toContain("<button");
  });

  it("舊格式的全文：只列重點，不顯示位置，也不是按鈕", () => {
    const out = html(createElement(PointList, { points, body: parseWorkBody("one line summary", 2), language, active: 1, onToggle: noop }));
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).not.toContain("crew-review__point-place");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("aria-pressed");
  });

  it("可以點選：有位置的列是 aria-pressed 的按鈕，選中的是 true", () => {
    const out = html(createElement(PointList, { points, body: parseWorkBody(STRUCTURED, 2), language, active: 2, onToggle: noop }));
    expect(out.match(/<button type="button" class="crew-review__point" aria-pressed="(true|false)"/g)).toEqual([
      '<button type="button" class="crew-review__point" aria-pressed="false"',
      '<button type="button" class="crew-review__point" aria-pressed="true"',
    ]);
  });

  it("只有部分重點有位置：沒有位置的那一列不是按鈕", () => {
    const body = parseWorkBody(["@@ reply/greeting", `Hi ${mark(1, "there")}`].join("\n"), 2);
    const out = html(createElement(PointList, { points, body, language, onToggle: noop }));
    expect(out.match(/<button /g)).toHaveLength(1);
    expect(out).toContain('<div class="crew-review__point">');
  });
});

describe("交件本身", () => {
  const view = (body: string, changes = { mode: "items" as const, items: [{ path: "reply/p2", summary: "Week" }] }, active: number | null = null) =>
    html(createElement(BodyView, { name: t.deliverableReply, body: parseWorkBody(body, 2), raw: body, changes, language, active }));

  it("詞句重點有底線的片段與上標編號；整個區塊的重點標在區塊上", () => {
    const out = view(STRUCTURED);
    expect(out).toContain(`aria-label="${t.deliverableReply}"`);
    expect(out).toMatch(/<span class="crew-review__mark" data-point="1">next week<sup class="crew-point-number" aria-hidden="true">1<\/sup>/);
    expect(out).toContain(`<span class="visually-hidden">${fill(t.pointMark, { n: 1 })}</span>`);
    expect(out).toMatch(/class="crew-review__block-text" data-point="2">/);
    expect(out).not.toContain("<mark");
  });

  it("選中的重點：內容中對應的片段或區塊有 data-active，其他沒有", () => {
    const changes = { mode: "items" as const, items: [] };
    expect(view(STRUCTURED, changes, 1)).toMatch(/class="crew-review__mark" data-point="1" data-active="true"/);
    expect(view(STRUCTURED, changes, 1)).not.toMatch(/data-point="2" data-active/);
    expect(view(STRUCTURED, changes, 2)).toMatch(/class="crew-review__block-text" data-point="2" data-active="true"/);
    expect(view(STRUCTURED, changes, null)).not.toContain("data-active");
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

  it("少看：變更收成一行，「逐項列出」預設收起", () => {
    const items = [
      { path: "reply/p2", summary: "Week" },
      { path: "reply/greeting", summary: "Tone" },
    ];
    const raw = STRUCTURED;
    const out = html(createElement(BodyView, { name: "Reply", body: parseWorkBody(raw, 2), raw, changes: { mode: "summary", count: 2 }, changeItems: items, language }));
    expect(out).toContain(fill(t.changesSummary, { count: 2, places: ["Week", "Tone"].join(t.listSeparator) }, language));
    expect(out).not.toContain(fill(t.modified, { summary: "Week" }));
    expect(out).toContain(`aria-expanded="false" aria-controls="crew-review-changes">${t.changesList}</button>`);
    expect(out).toMatch(/<ul id="crew-review-changes" class="crew-review__changes-items" hidden="">/);
    expect(out.match(/<li>/g)).toHaveLength(2);
  });

  it("少看但沒有變更：不顯示變更的那一行", () => {
    const out = view(STRUCTURED, { mode: "summary", count: 0 } as never);
    expect(out).not.toContain("crew-review__changes-line");
  });
});

describe("驗收面板的樣式", () => {
  const css = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string) => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";

  it("內容中的重點是 2px 墨色底線；整個區塊的重點是 2px 墨色左線", () => {
    expect(block(".crew-review__mark")).toContain("underline 2px var(--color-text)");
    expect(block(".crew-review__block-text[data-point]")).toContain("border-inline-start: 2px solid var(--color-text)");
  });

  it("選中的重點列是 1px 墨色內框；內容中對應的位置是 surfaceRaised 底", () => {
    expect(block('button.crew-review__point[aria-pressed="true"]')).toContain("box-shadow: inset 0 0 0 1px var(--color-text)");
    expect(css).toMatch(/\.crew-review__mark\[data-active\],\s*\.crew-review__block-text\[data-active\] \{\s*background: var\(--color-surfaceRaised\)/);
  });

  it("「影響信任」是 danger 字；「確定退回」是墨色實心", () => {
    expect(block('.crew-review__impact[data-impact="trust"]')).toContain("color: var(--color-danger)");
    expect(block("button.crew-review__confirm")).toContain("background: var(--color-text)");
  });
});
