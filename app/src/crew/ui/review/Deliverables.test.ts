// 驗收面板 v3 的四種交件（#72 計畫第 3、7 點）：回信、貼文、知識庫條目、程式修改的呈現與重點標記
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "../../../client/i18n";
import { clientConfig } from "../../../client/load";
import { crewStrings } from "../../i18n";
import { parseWorkBody } from "../../work/body";
import { positionLabel } from "../glossary";
import { BodyView } from "./BodyView";
import type { Deliverable } from "./conclusion";
import panelCss from "../ReviewView.css?raw";

const language = clientConfig.client.defaultLanguage;
const t = crewStrings("review", language);
const open = String.fromCodePoint(0x3014);
const close = String.fromCodePoint(0x3015);
const mark = (n: number, text: string) => `${open}${n}${close}${text}${open}/${n}${close}`;

function view(deliverable: Deliverable, lines: string[], opts: { changes?: { path: string; summary: string }[]; active?: number | null; reference?: string | null } = {}) {
  const raw = lines.join("\n");
  const node: ReactNode = createElement(BodyView, {
    name: "Deliverable",
    body: parseWorkBody(raw, 2),
    raw,
    changes: { mode: "items", items: opts.changes ?? [] },
    language,
    active: opts.active ?? null,
    deliverable,
    reference: opts.reference ?? null,
  });
  return renderToStaticMarkup(createElement("div", null, node));
}

describe("回信", () => {
  const lines = ["@@ reply/to", "Ms. Lin", "@@ reply/subject", "Arrival", "@@ reply/greeting", "Hello", "@@ reply/p2", `Arrives ${mark(1, "next week")}.`, "@@ reply/closing [point 2]", "Bye"];

  it("寄給與主旨在上方，段落依序；左側欄是段落名稱，修改過的段落標「已修改」", () => {
    const out = view("reply", lines, { changes: [{ path: "reply/p2", summary: "Week" }] });
    expect(out).toContain('data-deliverable="reply"');
    expect(out).toMatch(/class="crew-review__reply-head"><div class="crew-review__block" data-part="reply\/to">.*data-part="reply\/subject"/);
    for (const key of ["reply/to", "reply/subject", "reply/p2", "reply/closing"]) expect(out).toContain(`<span>${positionLabel(key, language)}</span>`);
    expect(out).toContain(fill(t.modified, { summary: "Week" }));
    expect(out).toMatch(/class="crew-review__mark" data-point="1">next week/);
    expect(out).toMatch(/data-part="reply\/closing">.*class="crew-review__block-text" data-point="2">Bye/);
  });
});

describe("貼文", () => {
  it("帳號列有圓形首字，各部分依序，圖片是佔位方塊與圖片說明", () => {
    const out = view("post", ["@@ post/account", "Example Co", "@@ post/title", "New", "@@ post/body", `Price ${mark(1, "$9")}`, "@@ post/hashtags", "#new", "@@ post/image", "Photo", "@@ post/image-alt", "A cup"]);
    expect(out).toContain('<span class="crew-review__avatar" aria-hidden="true">E</span>Example Co');
    expect(out.match(/data-part="post\/[a-z-]+"/g)).toEqual(["account", "title", "body", "hashtags", "image", "image-alt"].map((k) => `data-part="post/${k}"`));
    expect(out).toContain(positionLabel("post/image-alt", language));
    expect(out).not.toContain("<img");
    expect(out).toMatch(/data-point="1">\$9/);
  });
});

describe("知識庫條目", () => {
  const lines = ["@@ kb/pre-orders [point 2] | Pre-orders", "@@ kb/pre-orders#owner [required] [point 1] | Owner", "Ops", "@@ kb/pre-orders#note | Note", "@@ kb/pre-orders#date [required] | Date"];

  it("條目名稱＋欄位清單；必填欄位標「必填」", () => {
    const out = view("kb", lines, { changes: [{ path: "kb/pre-orders", summary: "New entry" }] });
    expect(out).toMatch(/<p class="crew-review__kb-title" data-point="2">Pre-orders<sup/);
    expect(out).toContain(fill(t.modified, { summary: "New entry" }));
    expect(out.match(/<dt /g)).toHaveLength(3);
    expect(out.match(new RegExp(`class="crew-review__required">${t.fieldRequired}<`, "g"))).toHaveLength(2);
    expect(out).toMatch(/<dd class="crew-review__block-text" data-point="1">Ops<\/dd>/);
  });

  it("空白的必填欄位是「空白・必填」，不是必填的空白欄位是「（空白）」", () => {
    const out = view("kb", lines);
    expect(out).toContain(`<span class="crew-review__empty-required">${t.fieldEmptyRequired}</span>`);
    expect(out.match(/crew-review__empty-required/g)).toHaveLength(1);
    expect(out).toContain(`<span class="muted">${t.fieldEmpty}</span>`);
  });

  it("選中條目的重點：條目名稱有 data-active", () => {
    expect(view("kb", lines, { active: 2 })).toMatch(/class="crew-review__kb-title" data-point="2" data-active="true"/);
  });
});

describe("程式修改", () => {
  const lines = ["@@ src/a.tsx [added]", `Adds ${mark(1, "search")}`, "@@ src/b.tsx [modified]", "Wires it", "@@ pr/description", `Summary ${mark(2, "rules")}`];

  it("檔案清單有等寬的路徑與新增／修改；PR 描述預設收起；有參照文字與合併的說明", () => {
    const out = view("code", lines, { reference: "example-org/site#1・PR #2" });
    expect(out).toContain(`aria-label="${t.codeFiles}"`);
    expect(out).toContain(`<span class="crew-review__ref">src/a.tsx</span>`);
    expect(out).toContain(`data-change="added">${t.fileAdded}</span>`);
    expect(out).toContain(`data-change="modified">${t.fileModified}</span>`);
    expect(out).toMatch(new RegExp(`<details class="crew-review__details crew-review__pr"><summary>${t.prDescription}</summary>`));
    expect(out).toMatch(/<details[^>]*>.*data-point="2">rules/);
    expect(out).toContain('<span class="crew-review__ref">example-org/site#1・PR #2</span>');
    expect(out).toContain(t.mergeNote);
    expect(out).not.toContain("<a ");
  });

  it("沒有參照時不顯示參照的一行", () => {
    expect(view("code", lines)).not.toContain("crew-review__code-ref");
  });
});

describe("解析有錯時退回純文字", () => {
  it("四種交件都是純文字，不畫標記", () => {
    for (const d of ["reply", "post", "kb", "code"] as const) {
      const out = view(d, ["@@ reply/p2", `${open}1${close}unclosed`]);
      expect(out).toContain('<p class="crew-review__body">');
      expect(out).not.toContain("data-deliverable");
    }
  });
});

describe("四種交件的樣式", () => {
  const css = panelCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string) => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";

  it("空白的必填欄位是 1px danger 虛線框、6px 圓角、danger 字", () => {
    const rule = block(".crew-review__empty-required");
    expect(rule).toContain("border: 1px dashed var(--color-danger)");
    expect(rule).toContain("border-radius: 6px");
    expect(rule).toContain("color: var(--color-danger)");
  });

  it("圖片的佔位方塊是 surfaceRaised 底、虛線框", () => {
    const rule = block('.crew-review__block[data-part="post/image"] .crew-review__block-text');
    expect(rule).toContain("background: var(--color-surfaceRaised)");
    expect(rule).toContain("dashed");
  });
});
