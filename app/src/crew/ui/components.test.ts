// AI 員工畫面共用的元件（#66，設計規格 v3 第 4 節）：AI 標記、層級徽章、結論、系統檢查的標籤、收起的區塊；相對期限（#193）
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { AiMark, CheckTag, CollapsedFields, DotMark, DotRow, dotsSummary, DueTag, dueTone, employeeOptionText, LevelBadge, relativeDueText, ScheduleLine, VerdictLine, withEmployee } from "./components";
import { shortDate } from "../time";
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
  it("pill，逐項看 textMuted 框＋text 字；看重點 success 框＋字、不填滿", () => {
    expect(html(createElement(LevelBadge, { level: "light", children: "L" }))).toContain('<span class="badge crew-level-badge" data-level="light">L</span>');
    expect(rule(".badge.crew-level-badge")).toContain("border-color: var(--color-textMuted)");
    expect(rule(".badge.crew-level-badge")).toContain("color: var(--color-text)");
    const light = rule('.badge.crew-level-badge[data-level="light"]');
    expect(light).toContain("border-color: var(--color-success)");
    expect(light).not.toContain("background");
  });
});

describe("結論（#195）", () => {
  const verdict = (tone: "pass" | "fail" | "pending") => html(createElement(VerdictLine, { tone, text: "T" }));

  it("未通過：ui-verdict--bad、22px ✕ 圖示＋一句話；role=status", () => {
    const out = verdict("fail");
    expect(out).toContain('class="ui-verdict ui-verdict--bad crew-verdict"');
    expect(out).toContain('role="status"');
    expect(out).toContain('width="22"');
    expect(out).toContain('d="M6 6l12 12M18 6L6 18"');
    expect(out).toMatch(/<\/svg>T<\/p>/);
  });

  it("都通過：ui-verdict--ok 與勾；檢查中：ui-verdict--wait 與時鐘", () => {
    expect(verdict("pass")).toContain("ui-verdict--ok");
    expect(verdict("pass")).toContain('d="M5 12.5l4.5 4.5L19 7"');
    expect(verdict("pending")).toContain("ui-verdict--wait");
    expect(verdict("pending")).toContain('d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2"');
  });

  it("舊的結論列樣式已移除", () => {
    expect(cssText).not.toContain(".crew-conclusion");
    expect(cssText).not.toContain(".crew-check");
  });
});

describe("系統檢查的標籤（#195）", () => {
  const r = crewStrings("review", language);
  const tag = (status: "pass" | "fail" | "pending") => html(createElement(CheckTag, { name: "quote-match", status, language }));

  it("未通過：ui-check--bad（danger 框、粗體）、14px ✕ 圖示、白話名稱；螢幕閱讀器讀出「未通過」", () => {
    const out = tag("fail");
    expect(out).toContain('class="ui-check ui-check--bad"');
    expect(out).toContain('data-status="fail"');
    expect(out).toContain('width="14"');
    expect(out).toContain('d="M6 6l12 12M18 6L6 18"');
    expect(out).toContain(`</svg>${checkLabel("quote-match", language)}<`);
    expect(out).toContain(`<span class="visually-hidden">${fill(r.checkResult, { result: r.checkFail })}</span>`);
  });

  it("通過：ui-check--ok 與勾，讀出「通過」", () => {
    const out = tag("pass");
    expect(out).toContain('class="ui-check ui-check--ok"');
    expect(out).toContain('d="M5 12.5l4.5 4.5L19 7"');
    expect(out).toContain(fill(r.checkResult, { result: r.checkPass }));
  });

  it("檢查中：ui-check--wait（warning 框）與時鐘，讀出「檢查中」；不另加說明句", () => {
    const out = tag("pending");
    expect(out).toContain('class="ui-check ui-check--wait"');
    expect(out).toContain('d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2"');
    expect(out).toContain(fill(r.checkResult, { result: r.checkPending }));
    expect(out).not.toContain(checkSentence("quote-match", "pass", language)!);
  });

  it("畫面上不再出現「執行中」", () => {
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

describe("圓點（#83：信任頁與員工卡共用）", () => {
  const tr = crewStrings("trust", language);
  const count = (key: string, n: number) => key.replace("{count}", String(n));

  it("摘要只列出有的結果，依通過、做錯了、其他退回的順序", () => {
    expect(dotsSummary(["ok", "wrong", "ok"], language)).toBe([count(tr.dotsAriaOk, 2), count(tr.dotsAriaWrong, 1)].join(tr.dotsAriaSeparator));
    expect(dotsSummary(["neutral", "ok"], language)).toBe([count(tr.dotsAriaOk, 1), count(tr.dotsAriaNeutral, 1)].join(tr.dotsAriaSeparator));
    expect(dotsSummary([], language)).toBe("");
  });

  it("DotMark：做錯了是 ×，其他是空的；螢幕閱讀器不讀；可加上畫面自己的 class", () => {
    expect(html(createElement(DotMark, { dot: "wrong" }))).toContain('<span class="crew-dot" data-dot="wrong" aria-hidden="true">×</span>');
    expect(html(createElement(DotMark, { dot: "ok", className: "x" }))).toContain('<span class="crew-dot x" data-dot="ok" aria-hidden="true"></span>');
  });

  it("DotRow：整排是一張圖，aria-label 是摘要，每次一個圓點", () => {
    const out = html(createElement(DotRow, { dots: ["ok", "neutral", "wrong"], language }));
    expect(out).toContain(`role="img" aria-label="${dotsSummary(["ok", "neutral", "wrong"], language)}"`);
    expect(out.match(/class="crew-dot"/g)).toHaveLength(3);
  });

  it("DotRow 的事後更正（#164）：那一格中空並有提示，名稱加上「通過，MM/DD 事後更正為做錯了」，下方有圖例；沒有更正時沒有圖例", () => {
    const at = "2026-11-24T08:00:00.000Z";
    const tr = crewStrings("trust", language);
    const note = fill(tr.dotCorrected, { date: shortDate(at, language) });
    const out = html(createElement(DotRow, { dots: ["ok", "ok"], corrected: [null, at], language }));
    expect(out).toContain(`aria-label="${[dotsSummary(["ok", "ok"], language), note].join(tr.dotsAriaSeparator)}"`);
    expect(out).toContain(`data-corrected="true" title="${note}"`);
    expect(out).toContain(tr.dotLegendCorrected);
    expect(html(createElement(DotRow, { dots: ["ok"], corrected: [null], language }))).not.toContain(tr.dotLegendCorrected);
    expect(rule('.crew-dot[data-dot="ok"][data-corrected]')).toContain("border: 2px solid var(--color-success)");
  });

  it("通過＝success 實心、做錯了＝danger、其他退回＝textMuted 虛線", () => {
    expect(rule('.crew-dot[data-dot="ok"]')).toContain("background: var(--color-success)");
    expect(rule('.crew-dot[data-dot="wrong"]')).toContain("color: var(--color-danger)");
    expect(rule('.crew-dot[data-dot="neutral"]')).toContain("border: 1.5px dashed var(--color-textMuted)");
  });
});

describe("相對期限（#193）", () => {
  it("文字：逾期 N 天、今天到期、明天到期、N 天後到期（zh-TW 與 en）；沒有到期日是 null", () => {
    expect(relativeDueText({ kind: "overdue", days: 3 }, "zh-TW")).toBe("逾期 3 天");
    expect(relativeDueText({ kind: "today" }, "zh-TW")).toBe("今天到期");
    expect(relativeDueText({ kind: "tomorrow" }, "zh-TW")).toBe("明天到期");
    expect(relativeDueText({ kind: "inDays", days: 5 }, "zh-TW")).toBe("5 天後到期");
    expect(relativeDueText({ kind: "overdue", days: 1 }, "en")).toBe("1 day overdue");
    expect(relativeDueText({ kind: "overdue", days: 3 }, "en")).toBe("3 days overdue");
    expect(relativeDueText({ kind: "today" }, "en")).toBe("Due today");
    expect(relativeDueText({ kind: "tomorrow" }, "en")).toBe("Due tomorrow");
    expect(relativeDueText({ kind: "inDays", days: 7 }, "en")).toBe("Due in 7 days");
    expect(relativeDueText({ kind: "none" }, "zh-TW")).toBeNull();
  });

  it("標示：逾期 overdue、今天與明天、3 天內（SOON_DAYS）soon、其他 later", () => {
    expect(dueTone({ kind: "overdue", days: 1 })).toBe("overdue");
    expect(dueTone({ kind: "today" })).toBe("today");
    expect(dueTone({ kind: "tomorrow" })).toBe("tomorrow");
    expect(dueTone({ kind: "inDays", days: 2 })).toBe("soon");
    expect(dueTone({ kind: "inDays", days: 3 })).toBe("soon");
    expect(dueTone({ kind: "inDays", days: 4 })).toBe("later");
  });

  it("DueTag：逾期 ui-due--over、今天與明天 ui-due--soon、3 天內與其他只有 ui-due；沒有到期日時不顯示", () => {
    expect(html(createElement(DueTag, { due: { kind: "overdue", days: 2 }, language }))).toContain(`<span class="ui-due ui-due--over crew-due" data-due="overdue">${relativeDueText({ kind: "overdue", days: 2 }, language)}</span>`);
    expect(html(createElement(DueTag, { due: { kind: "today" }, language }))).toContain('class="ui-due ui-due--soon crew-due" data-due="today"');
    expect(html(createElement(DueTag, { due: { kind: "tomorrow" }, language }))).toContain(`class="ui-due ui-due--soon crew-due" data-due="tomorrow">${c.dueTomorrow}<`);
    expect(html(createElement(DueTag, { due: { kind: "inDays", days: 3 }, language }))).toContain('class="ui-due crew-due" data-due="soon"');
    expect(html(createElement(DueTag, { due: { kind: "inDays", days: 9 }, language }))).toContain('class="ui-due crew-due" data-due="later"');
    expect(html(createElement(DueTag, { due: { kind: "none" }, language }))).toBe("<div></div>");
  });

  it("3 天內是 warning（不粗體），其他是一般文字（沒有顏色規則）", () => {
    expect(rule('.crew-due[data-due="soon"]')).toContain("color: var(--color-warning)");
    expect(rule('.crew-due[data-due="soon"]')).not.toContain("font-weight");
    expect(rule('.crew-due[data-due="later"]')).toBe("");
    expect(rule(".crew-due")).toBe("");
  });

  it("ScheduleLine：沒有相對期限也不是「高」時不顯示", () => {
    expect(html(createElement(ScheduleLine, { item: { due: { kind: "none" }, priority: "normal" }, language }))).toBe("<div></div>");
    const out = html(createElement(ScheduleLine, { item: { due: { kind: "none" }, priority: "high" }, language }));
    expect(out).toContain(c.priorityHigh);
    expect(out).not.toContain("crew-due");
  });
});
