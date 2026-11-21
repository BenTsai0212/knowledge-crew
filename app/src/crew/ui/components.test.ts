// AI 員工畫面共用的元件（#66，設計規格 v3 第 4 節）：AI 標記、層級徽章、結論列、自動檢查列、收起的區塊
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { AiMark, CheckRow, CollapsedFields, ConclusionRow, employeeOptionText, LevelBadge, withEmployee } from "./components";
import { checkLabel, checkSentence } from "./glossary";
import css from "./components.css?raw";

const language = clientConfig.client.defaultLanguage;
const c = crewStrings("common", language);
const html = (node: ReactNode) => renderToStaticMarkup(createElement("div", null, node));
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
// 選擇器（或群組中的一行）完全相同的所有規則的宣告
const rule = (selector: string) =>
  [...cssText.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]()="]/g, "\\$&")}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("");

describe("AI 標記", () => {
  it("畫面上是「AI」，螢幕閱讀器讀翻譯檔的完整說法", () => {
    for (const lang of clientConfig.client.languages) {
      const out = html(createElement(AiMark, { language: lang }));
      expect(out).toContain('<span aria-hidden="true">AI</span>');
      expect(out).toContain(`<span class="visually-hidden">${crewStrings("common", lang).aiMark}</span>`);
    }
  });

  it("18px 高、1px text 框、4px 圓角、等寬字 10px", () => {
    const block = rule(".crew-ai-mark");
    for (const d of ["height: 18px", "border: 1px solid var(--color-text)", "border-radius: 4px", "font-family: var(--font-mono)", "font-size: 10px"]) {
      expect(block).toContain(d);
    }
  });

  it("範本的 {employee} 前加上 AI 標記，其他參數照常代入", () => {
    const out = html(withEmployee("{employee}・{workType}", { workType: "W" }, "員工甲", language));
    expect(out).toMatch(/<span class="crew-employee-name"><span class="crew-ai-mark">.*<\/span>員工甲<\/span>・W/);
    expect(html(withEmployee("{name} 經手", {}, "員工乙", language, "name"))).toContain("員工乙</span> 經手");
  });

  it("表單選項（只能放文字）的名字前也有 AI", () => {
    expect(employeeOptionText("員工甲", language)).toMatch(/^AI\s*員工甲$/);
  });
});

describe("層級徽章", () => {
  it("pill，逐項看 textMuted 框＋text 字；少看 success 框＋字、不填滿", () => {
    expect(html(createElement(LevelBadge, { level: "light", children: "L" }))).toContain('<span class="badge crew-level-badge" data-level="light">L</span>');
    expect(rule(".badge.crew-level-badge")).toContain("border-color: var(--color-textMuted)");
    expect(rule(".badge.crew-level-badge")).toContain("color: var(--color-text)");
    const light = rule('.badge.crew-level-badge[data-level="light"]');
    expect(light).toContain("border-color: var(--color-success)");
    expect(light).not.toContain("background");
  });
});

describe("結論列", () => {
  it("24px 圖示＋標題＋說明；未通過 danger、檢查中 warning，以分隔線隔開", () => {
    const out = html(createElement(ConclusionRow, { tone: "fail", title: "T", description: "D" }));
    expect(out).toContain('data-tone="fail"');
    expect(out).toContain('width="24"');
    expect(out).toMatch(/crew-conclusion__title">T<.*crew-conclusion__description">D</);
    expect(rule(".crew-conclusion")).toContain("border-top: 1px solid var(--color-border)");
    expect(rule('.crew-conclusion[data-tone="fail"]')).toContain("var(--color-danger)");
    expect(rule('.crew-conclusion[data-tone="pending"]')).toContain("var(--color-warning)");
    expect(rule(".crew-conclusion__title")).toContain("font-size: 18px");
    expect(rule(".crew-conclusion__description")).toContain("font-size: 14px");
  });
});

describe("自動檢查列", () => {
  const r = crewStrings("review", language);
  const row = (status: "pass" | "fail" | "pending") => html(createElement(CheckRow, { name: "quote-match", status, language }));

  it("未通過：✕ 圖示、白話名稱與說明、右側「未通過」；1px danger 框，狀態粗體", () => {
    const out = row("fail");
    expect(out).toContain('data-status="fail"');
    expect(out).toContain('d="M6 6l12 12M18 6L6 18"');
    expect(out).toContain(`crew-check__name">${checkLabel("quote-match", language)}<`);
    expect(out).toContain(`crew-check__sentence">${checkSentence("quote-match", "fail", language)}<`);
    expect(out).toContain(`crew-check__status">${r.checkFail}<`);
    expect(rule('.crew-check[data-status="fail"]')).toContain("border-color: var(--color-danger)");
    expect(rule('.crew-check[data-status="fail"] .crew-check__status')).toContain("font-weight: 700");
  });

  it("通過：無框、success 勾、右側「通過」", () => {
    const out = row("pass");
    expect(out).toContain('d="M5 12.5l4.5 4.5L19 7"');
    expect(out).toContain(`crew-check__status">${r.checkPass}<`);
    expect(rule(".crew-check")).toContain("border: 1px solid transparent");
    expect(rule('.crew-check[data-status="pass"] .crew-icon')).toContain("color: var(--color-success)");
  });

  it("檢查中：warning 時鐘、「檢查中」，沒有說明句", () => {
    const out = row("pending");
    expect(out).toContain('d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2"');
    expect(out).toContain(`crew-check__status">${r.checkPending}<`);
    expect(out).not.toContain("crew-check__sentence");
    expect(rule('.crew-check[data-status="pending"] .crew-icon')).toContain("color: var(--color-warning)");
  });

  it("都不用整片底色；畫面上不再出現「執行中」", () => {
    expect(rule(".crew-check")).toContain("background: transparent");
    expect(cssText).not.toMatch(/\.crew-check[^{]*\{[^}]*background: var/);
    expect(crewStrings("review", "zh-TW").checkPending).toBe("檢查中");
    expect(crewStrings("review", "en").checkPending).toBe("Checking");
  });
});

describe("收起的區塊", () => {
  const props = (expanded: boolean, onToggle = vi.fn()) => ({
    id: "f",
    fields: ["甲", "乙", "丙"],
    expanded,
    onToggle,
    language,
    children: createElement("p", null, "內容"),
  });

  it("收起時：按鈕 aria-expanded=false，列出收起的欄位，內容隱藏", () => {
    const out = html(createElement(CollapsedFields, props(false)));
    expect(out).toMatch(/<button type="button" class="crew-collapsed__toggle" aria-expanded="false" aria-controls="f">/);
    expect(out).toContain(c.collapsedFields.replace("{count}", "3").replace("{fields}", ["甲", "乙", "丙"].join(c.collapsedFieldsSeparator)));
    expect(out).toContain('<div id="f" class="crew-collapsed__content" hidden="">');
  });

  it("展開時：aria-expanded=true，文字改為「收起沒標重點的欄位」，內容顯示", () => {
    const out = html(createElement(CollapsedFields, props(true)));
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain(c.collapseFields);
    expect(out).toContain('<div id="f" class="crew-collapsed__content"><p>內容</p></div>');
  });

  it("按鈕（原生 button，鍵盤的 Enter／空白鍵可操作）切換展開與收起", () => {
    for (const expanded of [false, true]) {
      const onToggle = vi.fn();
      const tree = CollapsedFields(props(expanded, onToggle)) as ReactElement<{ children: ReactNode[] }>;
      const button = tree.props.children.find((n) => isValidElement(n) && n.type === "button") as ReactElement<{ onClick: () => void }>;
      button.props.onClick();
      expect(onToggle).toHaveBeenCalledWith(!expanded);
    }
  });

  it("1px 虛線框、透明底", () => {
    expect(rule(".crew-collapsed")).toContain("border: 1px dashed var(--color-textMuted)");
    expect(rule(".crew-collapsed")).toContain("background: transparent");
  });
});

describe("顏色規則（規格第 3 節第 1、2 點）", () => {
  const files = import.meta.glob<string>("./*.css", { query: "?raw", import: "default", eager: true });
  it("AI 員工畫面的 CSS 不用 mark 系列，warning 不做底色", () => {
    for (const [path, text] of Object.entries(files)) {
      expect(text, path).not.toMatch(/--color-mark/);
      expect(text, path).not.toMatch(/background[^;]*--color-warning/);
    }
  });
});
