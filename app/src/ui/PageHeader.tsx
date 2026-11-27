// 頁首（#179，設計規格 v4 第 4 節「頁首（每頁一個）」、v4.css 的 .page-head）：
// 所屬區塊（選填，小字）、主標題 h1、說明（選填，一句）、頁面動作（選填，右側；放不下時換到下一行）與分頁（選填）。
// 切換畫面後焦點移到 h1（WCAG 2.4.3，沿用 focusWhenShown 的做法：h1 有 tabIndex={-1}）：掛上時與 focusKey 改變時移過去。
// 焦點在開著的對話框內時不移動。頁內其他元件之後自己移動焦點時（例如打開一件工作），以它們為準（React 先執行前面兄弟元件的 effect）。
import { useEffect, useRef, type ReactNode } from "react";
import { CLOSING_CLASS } from "./dialog-motion";

interface Props {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  /** 同一個元件換了畫面（例如 AI 員工的子頁）時改變，焦點再移到 h1 */
  focusKey?: string;
  /** h1 的 id（aria-labelledby 用） */
  titleId?: string;
  className?: string;
}

export function PageHeader({ eyebrow, title, lead, actions, tabs, focusKey = "", titleId, className }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const h = heading.current;
    if (h === null) return;
    const focus = () => h.focus({ preventScroll: true });
    // 從底部面板切換畫面（例如手機的「更多」）：關閉的動畫期間頁面不能取得焦點，關閉時面板又把焦點還給打開它的按鈕；
    // 等面板關閉後再移到 h1（這個 listener 比面板自己的晚加上，所以在它之後執行）
    const sheet = document.querySelector(`dialog[open].${CLOSING_CLASS}`);
    if (sheet !== null) {
      sheet.addEventListener("close", focus, { once: true });
      return () => sheet.removeEventListener("close", focus);
    }
    // 開著的對話框帶著切換畫面（例如第一次來的導覽）時，焦點留在對話框
    if (document.activeElement?.closest('dialog[open], [role="dialog"]')) return;
    focus();
  }, [focusKey]);
  return (
    <header className={className === undefined ? "ui-page-head" : `ui-page-head ${className}`}>
      <div className="ui-page-head__row">
        <div className="ui-page-head__title">
          {eyebrow !== undefined && <p className="ui-page-head__eyebrow">{eyebrow}</p>}
          <h1 ref={heading} id={titleId} tabIndex={-1}>
            {title}
          </h1>
          {lead !== undefined && <p className="ui-page-head__lead">{lead}</p>}
        </div>
        {actions !== undefined && <div className="ui-page-head__actions">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
