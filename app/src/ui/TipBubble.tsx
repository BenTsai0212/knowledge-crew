// 小泡泡（#193）：details/summary＋ui-tip__body，「?」說明（Qmark.tsx）與「詳細」（DetailsTip.tsx）共用。
// 開關規則在 tip.ts：同一時間只開一個、Esc 關閉並把焦點放回按鈕、點泡泡外面關閉；鍵盤用 summary 原生的 Enter／空白鍵開關。
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { releaseTip, tipEscape, tipToggled, type TipHost } from "./tip";

export type TipAlign = "left" | "right";

interface Props {
  /** summary 的 class（ui-qmark 或 ui-tip__link） */
  triggerClass: string;
  /** summary 的可存取名稱；沒有時用 summary 的文字 */
  label?: string;
  trigger: ReactNode;
  /** 泡泡對齊按鈕的左緣（預設）或右緣（ui-tip--r） */
  align?: TipAlign;
  children: ReactNode;
}

export function TipBubble({ triggerClass, label, trigger, align = "left", children }: Props) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const host = useMemo<TipHost>(
    () => ({
      get open() {
        return details.current?.open ?? false;
      },
      set open(value: boolean) {
        if (details.current !== null) details.current.open = value;
      },
      contains: (node) => node instanceof Node && (details.current?.contains(node) ?? false),
      focusTrigger: () => summary.current?.focus(),
    }),
    [],
  );
  useEffect(() => {
    return () => releaseTip(host);
  }, [host]);
  return (
    <details ref={details} className={align === "right" ? "ui-tip ui-tip--r" : "ui-tip"} onToggle={() => tipToggled(host, document)} onKeyDown={(event) => tipEscape(host, event)}>
      <summary ref={summary} className={triggerClass} aria-label={label}>
        {trigger}
      </summary>
      <div className="ui-tip__body">{children}</div>
    </details>
  );
}
