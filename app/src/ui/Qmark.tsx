// 「?」說明（#193，設計規格 v5 第 5 節、docs/crew/design/v5/screens/13a-review-item.html 的 details.tip＋summary.qmark）：
// 18px 圓形按鈕（ui-qmark），打開 60 字內的說明；開關規則見 TipBubble.tsx 與 tip.ts。
import type { ReactNode } from "react";
import { TipBubble, type TipAlign } from "./TipBubble";

interface Props {
  /** 按鈕的可存取名稱（例如「這條守則是什麼」）；畫面上只有「?」 */
  label: string;
  /** 說明內容 */
  children: ReactNode;
  align?: TipAlign;
}

export function Qmark({ label, children, align }: Props) {
  return (
    <TipBubble triggerClass="ui-qmark" label={label} trigger="?" align={align}>
      {children}
    </TipBubble>
  );
}
