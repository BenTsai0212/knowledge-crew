// 分頁元件（#179，設計規格 v4 第 4 節「頁首」、v4.css 的 .tabs）：一種外觀、兩種語意。
// tabs：role="tablist"／"tab"、aria-selected、左右鍵（Home、End）切換，只有目前的分頁在 Tab 順序中（待審、上傳）。
// nav：<nav> 加按鈕、aria-current="page"（AI 員工的子頁）。
// 數字徽章用 ui-count（需要你處理的數 ui-count--you）；有 countText 時數字不進名稱，說明放在 aria-describedby。
// 放不下時橫向捲動（不換行），目前的分頁捲到看得見的中間；右側還有分頁時加上 ui-tabs--more（漸層提示，#288）。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { nextTab, overflowsEnd } from "./review-helpers";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** 數字徽章；undefined 或 0 不顯示 */
  count?: number;
  /** 需要你處理的數（primary 底） */
  you?: boolean;
  /** 數字的說明（例如「3 件待驗收」）：有的話數字不進分頁的名稱，改以 aria-describedby 讀出 */
  countText?: string;
}

interface Props<T extends string> {
  kind: "tabs" | "nav";
  label: string;
  items: readonly TabItem<T>[];
  current: T;
  onSelect: (id: T) => void;
  /** 分頁的 id 是 `${idPrefix}-tab-${id}`；tabs 的 aria-controls 是 `${idPrefix}-panel` */
  idPrefix: string;
}

interface Span {
  left: number;
  width: number;
}

/** 目前的分頁捲到分頁列中間要捲動多少（正數往右）；瀏覽器會把 scrollLeft 限制在可捲動的範圍內 */
export function centerDelta(row: Span, item: Span): number {
  return Math.round(item.left + item.width / 2 - (row.left + row.width / 2));
}

export function Tabs<T extends string>({ kind, label, items, current, onSelect, idPrefix }: Props<T>) {
  const list = useRef<HTMLDivElement & HTMLElement>(null);
  const [more, setMore] = useState(false);
  const check = () => {
    if (list.current !== null) setMore(overflowsEnd(list.current));
  };
  useEffect(() => {
    const el = list.current;
    const item = el?.querySelector<HTMLElement>(kind === "tabs" ? '[aria-selected="true"]' : '[aria-current="page"]');
    if (!el || !item || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += centerDelta(el.getBoundingClientRect(), item.getBoundingClientRect());
  }, [current, kind]);
  useEffect(check);
  useEffect(() => {
    const el = list.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const onKeyDown = (ev: KeyboardEvent) => {
    const next = nextTab(
      items.map((x) => x.id),
      current,
      ev.key,
    );
    if (next === null) return;
    ev.preventDefault();
    onSelect(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };
  const className = more ? "ui-tabs ui-tabs--more" : "ui-tabs";
  const buttons = items.map((x) => {
    const on = x.id === current;
    const id = `${idPrefix}-tab-${x.id}`;
    const shown = x.count !== undefined && x.count > 0;
    const described = shown && x.countText !== undefined;
    return (
      <button
        key={x.id}
        type="button"
        id={id}
        className="ui-tab"
        {...(kind === "tabs" ? { role: "tab", "aria-selected": on, "aria-controls": `${idPrefix}-panel`, tabIndex: on ? 0 : -1 } : { "aria-current": on ? ("page" as const) : undefined })}
        aria-describedby={described ? `${id}-count` : undefined}
        onClick={() => onSelect(x.id)}
      >
        {x.label}
        {shown && (
          <span className={x.you ? "ui-count ui-count--you" : "ui-count"} aria-hidden={described || undefined}>
            {/* 數字在名稱中時前面留一個空白，名稱讀成「待審 3」 */}
            {!described && <span className="visually-hidden"> </span>}
            {x.count}
          </span>
        )}
        {described && (
          <span id={`${id}-count`} hidden>
            {x.countText}
          </span>
        )}
      </button>
    );
  });
  return kind === "tabs" ? (
    <div ref={list} className={className} role="tablist" aria-label={label} onKeyDown={onKeyDown} onScroll={check}>
      {buttons}
    </div>
  ) : (
    <nav ref={list} className={className} aria-label={label} onScroll={check}>
      {buttons}
    </nav>
  );
}
