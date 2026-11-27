// 「最近的變化」的鈴鐺與面板（#182，crew ADR 0009 第四節）：外框（桌機側欄、平板的圖示側欄、手機頂端列）的接入點只放這個元件（NavProps 的 bell）。
// 鈴鐺不顯示數字（不記錄已讀）；打開時才讀取，列出最近 4 則（recent-changes.ts），點一則切到那件工作或那位員工。
// 面板沿用 BottomSheet：桌機與平板是鈴鐺旁的面板（popover），手機是底部面板；Esc 關閉，關閉後焦點回到鈴鐺。
import { useEffect, useState, type ReactNode } from "react";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { BottomSheet } from "../../ui/BottomSheet";
import { crewStrings, type CrewTexts } from "../i18n";
import { shortDate } from "../time";
import type { ReturnReason } from "../trust/types";
import { withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import { readRecentChanges, type RecentChange, type RecentChangeKind } from "./recent-changes";
import type { CrewTarget } from "./sections";
import "./RecentChanges.css";

// 圖示（crew 設計規格 v5 的 01-home.html「最近的變化」）：退回是返回箭頭、守則是書籤、審查方式是眼睛、抽查是放大鏡
const BELL_ICON = "M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4";
const CHANGE_ICONS: Record<RecentChangeKind, string> = {
  returned: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  guideline: "M6 3h12v18l-6-4-6 4z",
  level: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  spot: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M21 21l-5-5",
};

const REASON_KEYS: Record<ReturnReason, "reasonWrong" | "reasonDifferentApproach" | "reasonProcess"> = {
  wrong: "reasonWrong",
  different_approach: "reasonDifferentApproach",
  process: "reasonProcess",
};

function Icon({ d, size }: { d: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** 一則變化的句子（沿用工作帳本的用詞；新用詞在之後的 Issue 一起換） */
function sentence(change: RecentChange, t: CrewTexts<"changes">, language: LanguageCode) {
  const { event } = change;
  const ledger = crewStrings("ledger", language);
  const values = {
    title: event.assignment?.title ?? "",
    reason: event.reason === null ? "" : ledger[REASON_KEYS[event.reason]],
    workType: workTypeLabel(event.workTypeId, language),
  };
  const template =
    change.kind === "returned" ? t.returned
    : change.kind === "spot" ? (event.kind === "returned" ? t.spotReturned : t.spotAccepted)
    : change.kind === "guideline" ? t.guideline
    : event.kind === "relax" ? t.relax
    : event.kind === "revoke" ? t.revoke
    : event.byCorrection ? t.autoResetCorrection
    : t.autoReset;
  return withEmployee(template, values, event.employee.displayName, language);
}

interface Props {
  db: Database | null;
  identity: string;
  language: LanguageCode;
  /** 面板的位置：手機是底部面板（bottom），桌機與平板是鈴鐺旁的面板（popover） */
  side: "bottom" | "popover";
  /** 點一則變化：切到 AI 員工頁的那個位置（App 的 openCrew） */
  onOpen(target: CrewTarget): void;
}

type State = "loading" | "failed" | RecentChange[];

export function RecentChangesBell({ db, identity, language, side, onOpen }: Props) {
  const t = crewStrings("changes", language);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!open || db === null) return;
    let current = true;
    setState("loading");
    readRecentChanges(db, identity, language).then(
      (changes) => current && setState(changes),
      () => current && setState("failed"),
    );
    return () => {
      current = false;
    };
  }, [open, db, identity, language]);

  let body: ReactNode;
  if (state === "loading") body = <p className="muted crew-changes__note">{t.loading}</p>;
  else if (state === "failed") body = <p className="error crew-changes__note" role="alert">{t.loadFailed}</p>;
  else if (state.length === 0) body = <p className="muted crew-changes__note">{t.empty}</p>;
  else
    body = (
      <ol className="crew-changes">
        {state.map((change) => (
          <li key={change.id} data-kind={change.kind}>
            <button type="button" className="crew-changes__item" onClick={() => (setOpen(false), onOpen(change.target))}>
              <span className={change.kind === "returned" || (change.kind === "spot" && change.event.kind === "returned") ? "crew-changes__icon is-bad" : "crew-changes__icon"}>
                <Icon d={CHANGE_ICONS[change.kind]} size={16} />
              </span>
              <span className="crew-changes__text">
                <time className="crew-changes__date" dateTime={change.event.at}>
                  {shortDate(change.event.at, language)}
                </time>
                <span>{sentence(change, t, language)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    );

  return (
    <>
      {/* 不顯示數字（ADR 0009）：名稱只有「最近的變化」 */}
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon crew-bell" aria-label={t.bell} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon d={BELL_ICON} size={18} />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t.title} language={language} className="crew-changes-sheet" side={side}>
        {body}
      </BottomSheet>
    </>
  );
}
