// 頁首與分頁元件（#179）：語意、目前的分頁、鍵盤切換的對象與置中的捲動量。
// 瀏覽器中的焦點與捲動在 e2e（e2e/page-header.spec.ts、crew-mobile.spec.ts）。
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import { nextTab } from "./review-helpers";
import { centerDelta, Tabs, type TabItem } from "./Tabs";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const items: TabItem<"a" | "b" | "c">[] = [
  { id: "a", label: "甲" },
  { id: "b", label: "乙", count: 3 },
  { id: "c", label: "丙", count: 2, you: true, countText: "2 件待驗收" },
];
const tabs = (kind: "tabs" | "nav", current: "a" | "b" | "c" = "a") =>
  html(createElement(Tabs<"a" | "b" | "c">, { kind, label: "畫面", items, current, onSelect: () => {}, idPrefix: "x" }));

describe("PageHeader", () => {
  it("剛好一個 h1，可以接受程式移入焦點（tabIndex=-1）", () => {
    const out = html(createElement(PageHeader, { title: "待審" }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('<h1 tabindex="-1">待審</h1>');
    expect(out).toMatch(/^<header class="ui-page-head">/);
  });

  it("所屬區塊、說明、動作與分頁都是選填；有的時候依序在 h1 前、後與右側", () => {
    expect(html(createElement(PageHeader, { title: "T" }))).not.toMatch(/eyebrow|__lead|__actions/);
    const out = html(createElement(PageHeader, { eyebrow: "AI 員工", title: "員工", lead: "一句說明", actions: createElement("button", null, "重新整理"), tabs: createElement("nav", null), titleId: "t" }));
    const at = (s: string) => out.indexOf(s);
    expect(at('class="ui-page-head__eyebrow">AI 員工')).toBeLessThan(at("<h1"));
    expect(at('<h1 id="t"')).toBeLessThan(at('class="ui-page-head__lead">一句說明'));
    expect(at("ui-page-head__lead")).toBeLessThan(at('class="ui-page-head__actions"><button>重新整理'));
    expect(at("ui-page-head__actions")).toBeLessThan(at("<nav>"));
  });

  it("說明下方的其他內容（首頁的今日摘要、可見範圍）放在標題欄內、說明之後，不包在說明的 p 裡", () => {
    const out = html(createElement(PageHeader, { title: "晚安", lead: "一句說明", className: "home__top" }, createElement("p", { className: "summary" }, "7 件等你驗收")));
    expect(out).toMatch(/^<header class="ui-page-head home__top">/);
    expect(out).toContain('一句說明</p><p class="summary">7 件等你驗收</p></div>');
    expect(out.indexOf("summary")).toBeLessThan(out.indexOf("</header>"));
    // 沒有其他內容時，標題欄只有 h1 與說明
    expect(html(createElement(PageHeader, { title: "T", lead: "L" }))).toContain('<p class="ui-page-head__lead">L</p></div>');
  });
});

describe("Tabs", () => {
  it("tabs：tablist／tab、aria-selected、aria-controls；只有目前的分頁在 Tab 順序中", () => {
    const out = tabs("tabs", "b");
    expect(out).toContain('role="tablist" aria-label="畫面"');
    expect(out.match(/role="tab"/g)).toHaveLength(3);
    expect(out).toContain('id="x-tab-b" class="ui-tab" role="tab" aria-selected="true" aria-controls="x-panel" tabindex="0"');
    expect(out).toContain('id="x-tab-a" class="ui-tab" role="tab" aria-selected="false" aria-controls="x-panel" tabindex="-1"');
    expect(out).not.toContain("aria-current");
  });

  it("nav：<nav> 加按鈕，目前的子頁 aria-current=page，沒有 tab 的角色", () => {
    const out = tabs("nav", "c");
    expect(out).toMatch(/^<nav class="ui-tabs" aria-label="畫面">/);
    expect(out).toContain('id="x-tab-c" class="ui-tab" aria-current="page"');
    expect(out.match(/aria-current/g)).toHaveLength(1);
    expect(out).not.toMatch(/role="tab/);
  });

  it("數字徽章：中性 ui-count 在名稱中；需要你的 ui-count--you，有說明時數字不進名稱、說明在 aria-describedby", () => {
    const out = tabs("tabs");
    expect(out).toContain('乙<span class="ui-count"><span class="visually-hidden"> </span>3</span>');
    expect(out).toContain('aria-describedby="x-tab-c-count"');
    expect(out).toContain('丙<span class="ui-count ui-count--you" aria-hidden="true">2</span><span id="x-tab-c-count" hidden="">2 件待驗收</span>');
    expect(out).not.toContain('id="x-tab-a-count"');
  });

  it("數字是 0 或沒有時不顯示徽章", () => {
    const out = html(createElement(Tabs<"a">, { kind: "nav", label: "L", items: [{ id: "a", label: "甲", count: 0, countText: "0 件" }], current: "a", onSelect: () => {}, idPrefix: "y" }));
    expect(out).not.toContain("ui-count");
    expect(out).not.toContain("aria-describedby");
  });

  it("鍵盤：左右鍵循環、Home／End 到頭尾，其他鍵不處理", () => {
    const ids = items.map((x) => x.id);
    expect(nextTab(ids, "a", "ArrowRight")).toBe("b");
    expect(nextTab(ids, "c", "ArrowRight")).toBe("a");
    expect(nextTab(ids, "a", "ArrowLeft")).toBe("c");
    expect(nextTab(ids, "b", "Home")).toBe("a");
    expect(nextTab(ids, "a", "End")).toBe("c");
    expect(nextTab(ids, "a", "Enter")).toBeNull();
  });

  it("目前的分頁捲到分頁列中間：右邊的往右、左邊的往左、已在中間時不動", () => {
    const row = { left: 16, width: 358 };
    expect(centerDelta(row, { left: 400, width: 80 })).toBe(245);
    expect(centerDelta(row, { left: -100, width: 60 })).toBe(-265);
    expect(centerDelta(row, { left: 155, width: 80 })).toBe(0);
  });
});
