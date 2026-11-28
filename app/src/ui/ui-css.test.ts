// 共用元件的 CSS（#178，設計規格 v4 第 5 節、v5 第 5 節；數值照 docs/crew/design/v5/screens/v4.css）：
// 每個元件的 class 都在、不寫死顏色、只用 theme 提供的變數，以及幾條關鍵規則。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import main from "../main.tsx?raw";
import css from "./ui.css?raw";
import { themeVariables } from "./theme";

const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(block: string): Record<string, string> {
  return Object.fromEntries([...`${block};`.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// 規則清單：{ media（不在 @media 中為 ""）, selector, body }
type Rule = { media: string; selector: string; body: string };
function parse(text: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  const read = (media: string) => {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1;
        return;
      }
      if (open === -1) return;
      const head = text.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith("@media")) {
        read(head.replace(/^@media\s*/, ""));
      } else {
        const end = text.indexOf("}", i);
        rules.push({ media, selector: head, body: text.slice(i, end) });
        i = end + 1;
      }
    }
  };
  read("");
  return rules;
}
const RULES = parse(cssText);

function rule(selector: string, media = ""): Record<string, string> {
  const found = RULES.filter((r) => r.media === media && r.selector === selector);
  expect(found.length, `${media} ${selector}`).toBeGreaterThan(0);
  return Object.assign({}, ...found.map((r) => declarations(r.body)));
}

const mediaRule = (media: string, selector: string) => rule(selector, media);

const CLASSES = [
  "ui-card", "ui-card--tight", "ui-card--flush", "ui-card-head",
  "ui-list", "ui-row", "ui-row__title", "ui-row__meta", "ui-row__status", "ui-row__trail", "ui-row--sel",
  "ui-count", "ui-count--you",
  "ui-badge", "ui-badge--quiet", "ui-badge--ok", "ui-badge--bad", "ui-badge--wait", "ui-badge--item", "ui-badge--light", "ui-badge--spot",
  "ui-ai",
  "ui-due", "ui-due--over", "ui-due--soon",
  "ui-btn", "ui-btn--primary", "ui-btn--ink", "ui-btn--ghost", "ui-btn--sm", "ui-btn--icon",
  "ui-seg",
  "ui-way",
  "ui-mode", "ui-mode--light", "ui-mode--spot",
  "ui-check", "ui-check--bad", "ui-check--ok", "ui-check--wait",
  "ui-verdict", "ui-verdict--bad", "ui-verdict--ok", "ui-verdict--wait",
  "ui-field", "ui-input", "ui-textarea", "ui-field--error", "ui-error-summary",
  "ui-choice", "ui-choice--on",
  "ui-disc",
  "ui-empty", "ui-empty--inline",
  "ui-tbl", "ui-tbl-wrap",
  "ui-dialog", "ui-scrim",
  "ui-qmark", "ui-tip", "ui-tip__link",
  "ui-page-head", "ui-page-head__row", "ui-page-head__title", "ui-page-head__eyebrow", "ui-page-head__lead", "ui-page-head__actions",
  "ui-tabs", "ui-tabs--more", "ui-tab",
];

describe("ui.css 的共用元件", () => {
  it("main.tsx 在 app.css 之後載入 ui.css", () => {
    const app = main.indexOf('import "./ui/app.css";');
    expect(app).toBeGreaterThan(-1);
    expect(main.indexOf('import "./ui/ui.css";')).toBeGreaterThan(app);
  });

  it("每個元件的 class 都有規則", () => {
    const defined = new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    expect(CLASSES.filter((c) => !defined.has(c))).toEqual([]);
  });

  it("class 一律以 ui- 開頭", () => {
    const classes = [...new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
    // 數字的小數點（0.15s、1.08）不是 class
    expect(classes.filter((c) => !c.startsWith("ui-") && !/^\d/.test(c) && c !== "num")).toEqual([]);
  });

  it("不寫死顏色（#hex、rgb()、hsl() 等）", () => {
    expect(cssText).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/);
  });

  it("用到的 --color-*、--radius-*、--font-* 都由 theme 提供（borderStrong 沒有設定時也有值）", () => {
    const provided = new Set(Object.keys(themeVariables(clientConfig.theme)));
    const used = [...new Set([...cssText.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
    expect(used.filter((v) => !provided.has(v) && v !== "--ui-hit")).toEqual([]);
    expect(used.filter((v) => /^--(?:color|radius|font)-/.test(v) === false)).toEqual(["--ui-hit"]);
  });

  it("沒有規則取消焦點框；可聚焦的元件有 2px focus 焦點框、外推 2px", () => {
    expect(cssText).not.toMatch(/outline(?:-style)?\s*:\s*(?:none|0)\s*;/);
    const focus = cssText.match(/:is\(([^)]*)\):focus-visible\s*\{([^}]*)\}/);
    expect(focus).not.toBeNull();
    expect(declarations(focus![2])).toEqual({ outline: "2px solid var(--color-focus)", "outline-offset": "2px" });
    for (const target of [".ui-btn", ".ui-seg button", ".ui-input", ".ui-textarea", ".ui-choice", ".ui-disc > summary", ".ui-qmark"]) {
      expect(focus![1], target).toContain(target);
    }
  });

  it("按鈕高度 40px，觸控 44px；小按鈕 32px，觸控 44px", () => {
    expect(rule(":root")).toEqual({ "--ui-hit": "40px" });
    expect(mediaRule("(pointer: coarse)", ":root")).toEqual({ "--ui-hit": "44px" });
    expect(rule(".ui-btn")).toMatchObject({ "min-height": "var(--ui-hit)", border: "1px solid var(--color-borderStrong)", "border-radius": "var(--radius-medium)" });
    expect(rule(".ui-btn--sm")["min-height"]).toBe("32px");
    expect(mediaRule("(pointer: coarse)", ".ui-btn--sm")["min-height"]).toBe("44px");
    expect(mediaRule("(pointer: coarse)", ".ui-seg button")["min-height"]).toBe("44px");
    expect(rule(".ui-btn--primary")).toMatchObject({ background: "var(--color-primary)", color: "var(--color-onPrimary)" });
    expect(rule(".ui-btn--ink")).toMatchObject({ background: "var(--color-text)", color: "var(--color-background)" });
  });

  it("清單列：列間 1px 分隔線，選取時左側 3px 墨色線", () => {
    expect(rule(".ui-row")["border-top"]).toBe("1px solid var(--color-border)");
    expect(rule(".ui-row--sel")).toEqual({ background: "var(--color-surfaceRaised)", "box-shadow": "inset 3px 0 0 var(--color-text)" });
  });

  it("徽章是外框 pill；抽查是墨色虛線框", () => {
    expect(rule(".ui-badge")).toMatchObject({ "border-radius": "var(--radius-pill)", border: "1px solid var(--color-borderStrong)", background: "transparent" });
    expect(rule(".ui-badge--spot")).toMatchObject({ border: "1px dashed var(--color-text)" });
    expect(rule(".ui-badge--bad")).toEqual({ "border-color": "var(--color-danger)", color: "var(--color-danger)" });
  });

  it("分段按鈕按下＝墨色底；審查方式開關：全部看＝墨色、只看標記處＝success", () => {
    expect(rule('.ui-seg button[aria-pressed="true"]')).toMatchObject({ background: "var(--color-text)", color: "var(--color-background)" });
    expect(rule(".ui-way")).toMatchObject({ "border-radius": "var(--radius-pill)" });
    expect(rule(".ui-way__opt--all")).toMatchObject({ background: "var(--color-text)" });
    expect(rule(".ui-way__opt--mark")).toMatchObject({ background: "var(--color-success)" });
  });

  it("結論（#195）：18px 粗體；未通過＝danger、都通過＝success、檢查中＝warning", () => {
    expect(rule(".ui-verdict")).toMatchObject({ "font-size": "18px", "font-weight": "700" });
    expect(rule(".ui-verdict--bad")).toEqual({ color: "var(--color-danger)" });
    expect(rule(".ui-verdict--ok")).toEqual({ color: "var(--color-success)" });
    expect(rule(".ui-verdict--wait")).toEqual({ color: "var(--color-warning)" });
  });

  it("驗收面板的狀態列：看重點是 success 框、抽查是墨色虛線框", () => {
    expect(rule(".ui-mode--light")).toEqual({ "border-color": "var(--color-success)" });
    expect(rule(".ui-mode--spot")).toEqual({ border: "1px dashed var(--color-text)" });
  });

  it("輸入框邊框用 borderStrong；錯誤時是 danger", () => {
    expect(rule(".ui-input,\n.ui-textarea")).toMatchObject({ border: "1px solid var(--color-borderStrong)", "min-height": "44px" });
    expect(rule(".ui-field--error .ui-input,\n.ui-field--error .ui-textarea,\n.ui-field--error .ui-choice-group")).toMatchObject({ "border-color": "var(--color-danger)" });
  });

  it("表格在 720px 以下每列一張，欄名取自 data-label；對話框在手機是底部面板", () => {
    expect(mediaRule("(max-width: 719px)", ".ui-tbl thead")).toEqual({ display: "none" });
    expect(mediaRule("(max-width: 719px)", ".ui-tbl td[data-label]::before")).toMatchObject({ content: "attr(data-label)" });
    expect(mediaRule("(max-width: 719px)", ".ui-scrim")).toMatchObject({ "align-items": "flex-end" });
    expect(mediaRule("(max-width: 719px)", ".ui-dialog")).toMatchObject({ "border-radius": "var(--radius-large) var(--radius-large) 0 0", width: "100%" });
  });

  it("頁首（#179）：h1 28px、手機 22px；動作放不下時換行；說明最多 68 字寬", () => {
    expect(rule(".ui-page-head h1")).toMatchObject({ "font-size": "28px", "font-weight": "700", margin: "0" });
    expect(mediaRule("(max-width: 719px)", ".ui-page-head h1")).toEqual({ "font-size": "22px" });
    expect(rule(".ui-page-head__row")).toMatchObject({ display: "flex", "flex-wrap": "wrap" });
    expect(rule(".ui-page-head__actions")["flex-wrap"]).toBe("wrap");
    expect(rule(".ui-page-head__lead")).toMatchObject({ color: "var(--color-textMuted)", "max-width": "68ch" });
  });

  it("分頁（#179）：單行橫向捲動、不顯示捲軸；目前的分頁是墨色 2px 底線與粗體；觸控目標至少 44px", () => {
    expect(rule(".ui-tabs")).toMatchObject({ display: "flex", "overflow-x": "auto", "scrollbar-width": "none" });
    expect(rule(".ui-tab")).toMatchObject({ "white-space": "nowrap", flex: "none", "min-height": "44px", "min-width": "44px" });
    const current = rule(".ui-tab[aria-current=\"page\"],\n.ui-tab[aria-selected=\"true\"]");
    expect(current).toMatchObject({ "border-bottom-color": "var(--color-text)", "font-weight": "700", color: "var(--color-text)" });
    expect(rule(".ui-tab:focus-visible")).toEqual({ outline: "2px solid var(--color-focus)", "outline-offset": "-2px" });
    expect(rule(".ui-tabs--more")["mask-image"]).toContain("linear-gradient");
  });

  it("深色模式不另寫規則（由 theme 的變數切換）", () => {
    expect(cssText).not.toMatch(/data-scheme|data-theme|prefers-color-scheme/);
  });
});
