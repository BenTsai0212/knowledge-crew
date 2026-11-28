// 「?」說明與「詳細」的小泡泡（#193，設計規格 v5 第 5 節）共用的開關規則，不依賴 React：
// 打開時關掉其他開著的泡泡（同一時間只開一個）；開著時 Esc 關閉並把焦點放回按鈕、在泡泡外按下指標就關閉。
// Esc 在 capture 階段攔下（preventDefault、stopPropagation），泡泡在對話框中時只關泡泡，不連對話框一起關。
// 元件（TipBubble.tsx）在 details 的 toggle 事件呼叫 tipToggled()，卸載時呼叫 releaseTip()；
// toggle 事件是非同步的，剛打開就按 Esc 時 document 還沒有 listener，所以 details 自己的 keydown 也呼叫 tipEscape()。

/** 一個泡泡：details 的 open、是否包含某個節點、把焦點放回 summary */
export interface TipHost {
  open: boolean;
  contains(node: unknown): boolean;
  focusTrigger(): void;
}

const active = new Map<TipHost, () => void>();

/** 移除這個泡泡的 document listener（已經關閉或卸載時呼叫；重複呼叫沒有影響）。 */
export function releaseTip(tip: TipHost): void {
  active.get(tip)?.();
  active.delete(tip);
}

function close(tip: TipHost): void {
  tip.open = false;
  releaseTip(tip);
}

/** Esc：開著時關閉、焦點放回按鈕，事件不再往下傳（對話框不跟著關）；有處理時回傳 true。 */
export function tipEscape(tip: TipHost, event: Pick<Event, "preventDefault" | "stopPropagation"> & { key?: string }): boolean {
  if (event.key !== "Escape" || !tip.open) return false;
  event.preventDefault();
  event.stopPropagation();
  close(tip);
  tip.focusTrigger();
  return true;
}

/** details 開或關之後呼叫：打開時關掉其他泡泡並開始聽 Esc 與外面的指標；關閉時停止。 */
export function tipToggled(tip: TipHost, doc: EventTarget): void {
  if (!tip.open) {
    releaseTip(tip);
    return;
  }
  if (active.has(tip)) return;
  for (const other of [...active.keys()]) if (other !== tip) close(other);
  const onKey = (event: Event) => {
    tipEscape(tip, event as KeyboardEvent);
  };
  const onPointer = (event: Event) => {
    if (!tip.contains(event.target)) close(tip);
  };
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  active.set(tip, () => {
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onPointer, true);
  });
}

/** 目前開著的泡泡數（測試用） */
export const openTipCount = (): number => active.size;

/** 「詳細」的內容：去掉空的項目，以分隔字（翻譯檔的 detailsTipSeparator，zh-TW 是「・」）連接 */
export function detailsText(items: readonly string[], separator: string): string {
  return items.map((item) => item.trim()).filter((item) => item !== "").join(separator);
}
