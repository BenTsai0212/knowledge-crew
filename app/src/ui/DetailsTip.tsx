// 「詳細」（#193，設計規格 v5 第 5 節、docs/crew/design/v5/screens/13a-review-item.html 的 details.tip＋summary.link）：
// 文字按鈕「詳細」（ui-tip__link，13px），打開與「?」相同的小泡泡，內容是以「・」連接的項目（來源、編號、交件時間、輪次、優先、到期日）。
// 空的項目略過；全部是空的時不顯示。開關規則見 TipBubble.tsx 與 tip.ts。
import { strings } from "../client/i18n";
import type { LanguageCode } from "../client/types";
import { detailsText } from "./tip";
import { TipBubble, type TipAlign } from "./TipBubble";

interface Props {
  items: readonly string[];
  align?: TipAlign;
  language: LanguageCode;
}

export function DetailsTip({ items, align, language }: Props) {
  const s = strings(language);
  const text = detailsText(items, s.detailsTipSeparator);
  if (text === "") return null;
  return (
    <TipBubble triggerClass="ui-tip__link" trigger={s.detailsTip} align={align}>
      {text}
    </TipBubble>
  );
}
