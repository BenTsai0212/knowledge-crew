// 第一次來的導覽（#122）：步驟、目標區塊、看過的紀錄與對話框位置的純函式；畫面在 Tour.tsx。
// 每一步切到對應的畫面（首頁或 crew 頁的某個位置），再以 CSS 選擇器找出要標出的區塊。
import type { Database } from "../../db/database";
import type { LanguageCode } from "../../client/types";
import type { CrewScreenKeys } from "../i18n";
import { readWorkList } from "./review";
import type { CrewTarget } from "./sections";

/** 每一步要切到的畫面：首頁、crew 頁的某個位置，或最近一件已回流知識庫的工作（找不到時是「工作與驗收」） */
export type TourDestination = { kind: "home" } | { kind: "crew"; target: CrewTarget } | { kind: "flowback" };

export interface TourStep {
  id: string;
  title: CrewScreenKeys["tour"];
  body: CrewScreenKeys["tour"];
  go: TourDestination;
  /** 要標出的區塊，依序取第一個找得到的；第一個以外的是退路（例如不能驗收的身分沒有決定列） */
  targets: readonly string[];
}

const WORKS: TourDestination = { kind: "crew", target: { section: "works" } };

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "today", title: "todayTitle", body: "todayBody", go: { kind: "home" }, targets: [".crew-home"] },
  { id: "review", title: "reviewTitle", body: "reviewBody", go: WORKS, targets: [".crew-review__pane", ".crew-review__panel"] },
  { id: "return", title: "returnTitle", body: "returnBody", go: WORKS, targets: [".crew-review__decision", ".crew-review__panel"] },
  {
    id: "guidelines",
    title: "guidelinesTitle",
    body: "guidelinesBody",
    go: { kind: "crew", target: { section: "employees" } },
    // 有等確認守則的員工卡（demo 是 Rowan）；沒有時是第一張卡的守則區塊（#151）
    targets: [".crew-employees__guidelines[data-pending]", ".crew-employees__guidelines"],
  },
  { id: "trust", title: "trustTitle", body: "trustBody", go: { kind: "crew", target: { section: "employees" } }, targets: [".crew-trust__row", ".crew-employees"] },
  // 抽查（#166）：demo 的 k17 是 Linden 看重點期間的第 5 件；事後更正（#164）：demo 的 k01 已通過後更正（#171）
  { id: "spot", title: "spotTitle", body: "spotBody", go: { kind: "crew", target: { section: "works", assignmentId: "k17" } }, targets: [".crew-review__spot", ".crew-review__panel"] },
  {
    id: "correction",
    title: "correctionTitle",
    body: "correctionBody",
    go: { kind: "crew", target: { section: "works", assignmentId: "k01" } },
    targets: [".crew-review__correction", ".crew-review__panel"],
  },
  { id: "flowback", title: "flowbackTitle", body: "flowbackBody", go: { kind: "flowback" }, targets: [".crew-review__knowledge", ".crew-review__panel"] },
];

/** 只找第一個目標的時間（毫秒）；過了之後退路也可以 */
export const PRIMARY_WAIT_MS = 1000;
/** 找目標的上限（毫秒）；過了就不標出區塊，只顯示說明 */
export const TARGET_WAIT_MS = 3000;

/** 依序找第一個存在的目標；elapsed 未到 PRIMARY_WAIT_MS 時只接受第一個（畫面切換中，退路可能先出現） */
export function pickTarget(targets: readonly string[], exists: (selector: string) => boolean, elapsed: number): string | null {
  const candidates = elapsed < PRIMARY_WAIT_MS ? targets.slice(0, 1) : targets;
  return candidates.find(exists) ?? null;
}

// ---- 看過的紀錄：localStorage，讀寫都包在 try/catch，讀不到時當成沒看過 ----

export const TOUR_STORAGE_KEY = "knowledge-crew.tour.seen";

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): SeenStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

export function readTourSeen(storage: () => SeenStorage | null = browserStorage): boolean {
  try {
    return storage()?.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTourSeen(storage: () => SeenStorage | null = browserStorage): void {
  try {
    storage()?.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // 私密瀏覽或被封鎖時不記住；這次工作階段仍以元件 state 為準
  }
}

// ---- 對話框的位置 ----

export interface Box {
  top: number;
  height: number;
}

/** 對話框放在目標的另一半：目標的中心在畫面下半部時放上方，否則放下方（手機的決定列固定在底部） */
export const dialogPlace = (target: Box | null, viewportHeight: number): "top" | "bottom" =>
  target !== null && target.top + target.height / 2 > viewportHeight / 2 ? "top" : "bottom";

/** 目標要捲動時的位置：放得下就置中，比畫面高就對齊上緣 */
export const scrollBlock = (target: Box, viewportHeight: number): ScrollLogicalPosition => (target.height > viewportHeight * 0.6 ? "start" : "center");

/** 手機（.app--phone）可用的範圍：頂端列的下緣到底部分頁列的上緣（視窗座標） */
export interface Frame {
  top: number;
  bottom: number;
}

/** 手機的對話框與底部分頁列、對話框與目標之間的間隔（px）；對話框放下方時離畫面底部 = 分頁列 72px＋此值（Tour.css） */
export const PHONE_GAP = 12;

/**
 * 手機：對話框橫跨整個寬度，所以放在下方，目標捲到對話框上方的空間（#131）。
 * 回傳目標上緣應在的位置（視窗座標）：放得下就在空間內置中，比空間高就對齊空間的上緣（至少上半部可見）。
 */
export function phoneTargetTop(targetHeight: number, frame: Frame, dialogHeight: number, gap = PHONE_GAP): number {
  const top = frame.top + gap;
  const room = frame.bottom - gap - dialogHeight - gap - top;
  return targetHeight >= room ? top : top + Math.floor((room - targetHeight) / 2);
}

/** 目標整個在畫面上（不必捲動） */
export const inView = (target: Box, viewportHeight: number): boolean => target.top >= 0 && target.top + target.height <= viewportHeight;

// ---- 回流知識庫那一步的工作 ----

/**
 * 「工作與驗收」最近驗收過的清單中，最新一件已回流知識庫的工作（ReviewView 只選得到清單上的工作）；
 * 沒有或目前身分看不到時是 null（改切到「工作與驗收」的預設選取）。
 */
export async function readTourFlowback(db: Database, identity: string, language: LanguageCode): Promise<string | null> {
  const list = await readWorkList(db, identity, language);
  const flowed = await db.withIdentity(identity, async (tx) =>
    (
      await tx.query<{ assignmentId: string }>(
        `SELECT DISTINCT w.assignment_id AS "assignmentId" FROM crew.knowledge_flowbacks f
         JOIN crew.reviews rv ON rv.id = f.review_id
         JOIN crew.works w ON w.id = rv.work_id`,
      )
    ).rows.map((r) => r.assignmentId),
  );
  const set = new Set(flowed);
  return list.recent.find((item) => item.verdict === "accepted" && set.has(item.id))?.id ?? null;
}
