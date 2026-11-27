// 「工作」子頁（#191，ADR 0009 第二節）：頁首下方的「清單｜看板」切換。清單＝原本的「工作與驗收」（ReviewView），
// 看板＝原本的「總覽」（OverviewView），內容不改。目前的模式只存在元件 state（一開始依 view）；點看板上的工作切回清單並選取那件。
import { useState } from "react";
import { crewStrings } from "../i18n";
import { OverviewView } from "./OverviewView";
import { ReviewView } from "./ReviewView";
import type { CrewScreenProps, CrewTarget } from "./sections";

export function WorksView(props: CrewScreenProps) {
  const t = crewStrings("common", props.language);
  const [board, setBoard] = useState(props.view === "board");
  // 看板上點一件工作：切回清單（CrewPage 以新的 assignmentId 重新掛上畫面；同一件時這裡也切回清單）
  const navigate = props.navigate && ((to: CrewTarget) => (to.section === "works" && setBoard(false), props.navigate!(to)));
  return (
    <div className="crew-view crew-works">
      <div className="crew-view__switch">
        <div className="ui-seg" role="group" aria-label={t.viewLabel}>
          <button type="button" aria-pressed={!board} onClick={() => setBoard(false)}>
            {t.viewList}
          </button>
          <button type="button" aria-pressed={board} onClick={() => setBoard(true)}>
            {t.viewBoard}
          </button>
        </div>
      </div>
      {board ? <OverviewView {...props} navigate={navigate} /> : <ReviewView {...props} />}
    </div>
  );
}
