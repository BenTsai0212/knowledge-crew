// 「?」說明與「詳細」（#193）：可存取名稱與結構（renderToStaticMarkup）、開關規則（tip.ts，以 EventTarget 模擬 document）、空項目略過。
// 瀏覽器中的鍵盤開關與 axe 在 e2e（crew-a11y.spec.ts）。
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { DetailsTip } from "./DetailsTip";
import { Qmark } from "./Qmark";
import { detailsText, openTipCount, releaseTip, tipEscape, tipToggled, type TipHost } from "./tip";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("Qmark", () => {
  it("details.ui-tip＞summary.ui-qmark：可存取名稱是 label，畫面上是「?」；說明在 ui-tip__body", () => {
    const out = html(createElement(Qmark, { label: "這條守則是什麼", children: "完整的守則" }));
    expect(out).toBe('<details class="ui-tip"><summary class="ui-qmark" aria-label="這條守則是什麼">?</summary><div class="ui-tip__body">完整的守則</div></details>');
  });

  it("align=right 時加上 ui-tip--r；預設不開", () => {
    const out = html(createElement(Qmark, { label: "L", align: "right", children: "x" }));
    expect(out).toMatch(/^<details class="ui-tip ui-tip--r">/);
    expect(out).not.toContain(" open");
  });
});

describe("DetailsTip", () => {
  for (const language of ["zh-TW", "en"]) {
    it(`${language}：summary.ui-tip__link 的文字是翻譯檔的「詳細」，內容以分隔字連接、略過空的項目`, () => {
      const s = strings(language);
      const out = html(createElement(DetailsTip, { items: ["客服信箱 來信 1054", "", "  ", "第 1 輪", "11/18 到期"], language }));
      expect(out).toContain(`<summary class="ui-tip__link">${s.detailsTip}</summary>`);
      expect(out).toContain(`<div class="ui-tip__body">${["客服信箱 來信 1054", "第 1 輪", "11/18 到期"].join(s.detailsTipSeparator)}</div>`);
    });
  }

  it("「詳細」與分隔：zh-TW 是「詳細」與「・」、en 是 Details 與 · ", () => {
    expect([strings("zh-TW").detailsTip, strings("zh-TW").detailsTipSeparator]).toEqual(["詳細", "・"]);
    expect([strings("en").detailsTip, strings("en").detailsTipSeparator]).toEqual(["Details", " · "]);
  });

  it("全部是空的項目時不顯示", () => {
    expect(html(createElement(DetailsTip, { items: ["", " "], language: "zh-TW" }))).toBe("");
    expect(html(createElement(DetailsTip, { items: [], language: "zh-TW" }))).toBe("");
  });

  it("align=right 時加上 ui-tip--r", () => {
    expect(html(createElement(DetailsTip, { items: ["a"], align: "right", language: "zh-TW" }))).toMatch(/^<details class="ui-tip ui-tip--r">/);
  });
});

describe("detailsText", () => {
  it("去掉前後空白與空的項目，以分隔字連接", () => {
    expect(detailsText(["客服信箱 來信 1054", "11/17 11:00 交件", "第 1 輪", "優先：高", "11/18 到期"], "・")).toBe("客服信箱 來信 1054・11/17 11:00 交件・第 1 輪・優先：高・11/18 到期");
    expect(detailsText([" a ", "", "b"], " · ")).toBe("a · b");
    expect(detailsText([], "・")).toBe("");
  });
});

// 假的 details：inside 是泡泡裡的節點；focused 記錄焦點是否回到按鈕
function fakeTip() {
  const inside = new Set<unknown>([{}]);
  const tip = {
    open: false as boolean,
    focused: 0,
    inside,
    contains: (node: unknown) => inside.has(node),
    focusTrigger() {
      tip.focused += 1;
    },
  } satisfies TipHost & Record<string, unknown>;
  return tip;
}

// 假的 document：Node 的 EventTarget 移除 capture 的 listener 時不會真的移除，所以自己記錄（只看 type 與 capture）
class FakeDoc implements EventTarget {
  private listeners = new Set<{ type: string; fn: EventListenerOrEventListenerObject; capture: boolean }>();
  addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (fn !== null) this.listeners.add({ type, fn, capture: options === true || (typeof options === "object" && options.capture === true) });
  }
  removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = options === true || (typeof options === "object" && options.capture === true);
    for (const l of this.listeners) if (l.type === type && l.fn === fn && l.capture === capture) this.listeners.delete(l);
  }
  dispatchEvent(event: Event): boolean {
    for (const l of [...this.listeners]) {
      if (l.type !== event.type) continue;
      // 只登記 capture：泡泡要在其他 handler 之前攔下 Esc
      expect(l.capture).toBe(true);
      if (typeof l.fn === "function") l.fn(event);
      else l.fn.handleEvent(event);
    }
    return !event.defaultPrevented;
  }
  get size() {
    return this.listeners.size;
  }
}

const key = (k: string) => Object.assign(new Event("keydown", { cancelable: true }), { key: k });
const pointer = (target: unknown) => {
  const e = new Event("pointerdown");
  Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("tipToggled", () => {
  const tips: TipHost[] = [];
  const make = () => {
    const t = fakeTip();
    tips.push(t);
    return t;
  };
  const open = (t: TipHost, doc: EventTarget) => {
    t.open = true;
    tipToggled(t, doc);
  };
  afterEach(() => {
    for (const t of tips.splice(0)) releaseTip(t);
  });

  it("開著時按 Esc：關閉、焦點回到按鈕、事件不再往下傳（preventDefault）", () => {
    const doc = new FakeDoc();
    const tip = make();
    open(tip, doc);
    expect(openTipCount()).toBe(1);
    const other = key("Enter");
    doc.dispatchEvent(other);
    expect(tip.open).toBe(true);
    const esc = key("Escape");
    doc.dispatchEvent(esc);
    expect(tip.open).toBe(false);
    expect(tip.focused).toBe(1);
    expect(esc.defaultPrevented).toBe(true);
    expect(other.defaultPrevented).toBe(false);
    expect(openTipCount()).toBe(0);
    // 關閉後不再聽 Esc
    doc.dispatchEvent(key("Escape"));
    expect(tip.focused).toBe(1);
    expect(doc.size).toBe(0);
  });

  it("在泡泡外面按下指標就關閉，焦點不移動；在泡泡裡（含按鈕）按下不關", () => {
    const doc = new FakeDoc();
    const tip = make();
    open(tip, doc);
    doc.dispatchEvent(pointer([...tip.inside][0]));
    expect(tip.open).toBe(true);
    doc.dispatchEvent(pointer({}));
    expect(tip.open).toBe(false);
    expect(tip.focused).toBe(0);
    expect(openTipCount()).toBe(0);
  });

  it("同一時間只開一個：打開另一個時，先開的關閉", () => {
    const doc = new FakeDoc();
    const a = make();
    const b = make();
    open(a, doc);
    open(b, doc);
    expect([a.open, b.open]).toEqual([false, true]);
    expect(openTipCount()).toBe(1);
    // Esc 只關 b，焦點回到 b 的按鈕
    doc.dispatchEvent(key("Escape"));
    expect([a.focused, b.focused, b.open]).toEqual([0, 1, false]);
  });

  it("用按鈕關閉（toggle 為關）時停止聽事件；重複的 toggle 不重複登記", () => {
    const doc = new FakeDoc();
    const tip = make();
    open(tip, doc);
    tipToggled(tip, doc);
    expect(openTipCount()).toBe(1);
    tip.open = false;
    tipToggled(tip, doc);
    expect(openTipCount()).toBe(0);
    tip.open = true;
    doc.dispatchEvent(key("Escape"));
    expect(tip.focused).toBe(0);
  });

  it("tipEscape：details 自己的 keydown（toggle 事件還沒到時）也能以 Esc 關閉；關著或別的鍵不處理", () => {
    const tip = make();
    const esc = key("Escape");
    expect(tipEscape(tip, esc)).toBe(false);
    expect(esc.defaultPrevented).toBe(false);
    tip.open = true;
    expect(tipEscape(tip, key("Tab"))).toBe(false);
    expect(tip.open).toBe(true);
    const esc2 = key("Escape");
    expect(tipEscape(tip, esc2)).toBe(true);
    expect([tip.open, tip.focused, esc2.defaultPrevented]).toEqual([false, 1, true]);
  });
});
