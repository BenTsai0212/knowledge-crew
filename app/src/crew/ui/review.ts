// 「工作與驗收」畫面的資料整理（#39 計畫第 3 節）：工作清單與驗收面板。讀取經 store.ts 與本檔的查詢，
// 一律經 db.withIdentity()，可見範圍由 RLS 決定。資料庫的文字以 demoText() 換成目前語言，找不到時用原文。
// 層級只由 reviewLevel() 決定，面板只依 reviewFocus() 的結果呈現。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import {
  getAssignmentWorks, getReviewDetails, getTrustSummary, listAssignments, listEmployees, listGuidelines, listWorkGuidelines, type AssignmentSummary, type GuidelineResult, type PointResult, type Priority, type SourceKind, type StoredFeedback, type StoredWork,
} from "../db/store";
import { DEMO } from "../demo/load";
import { demoText } from "../demo/texts";
import { readFlowbackPassage } from "../knowledge/origin";
import { parseWorkBody, type ParsedBody } from "../work/body";
import { crewToday, shownRelativeDue, type RelativeDue } from "../work/due";
import { sourceLabel } from "./refs";
import { deliverableOf, type Deliverable } from "./review/conclusion";
import { followedGuidelines, pendingGuidelineCount, type FollowedGuideline } from "./review/followed";
import { lightReason, type LightReason } from "./review/light";
import { DEMO_PARAMS } from "../trust/demo-params";
import { reviewFocus, reviewLevel } from "../trust/rules";
import type { ReturnReason, ReviewFocus, Verdict, WorkChange } from "../trust/types";

/** 「最近驗收過」最多幾筆（#39 的 `## 決定` 2） */
export const RECENT_LIMIT = 10;

export interface WorkListItem {
  id: string;
  title: string;
  sourceKind: SourceKind;
  sourceName: string;
  externalRef: string | null;
  /** 最新一輪的 PR 編號 */
  workRef: string | null;
  /** 職務說明（「客服」等）；沒有時是 null */
  employee: { id: string; displayName: string; roleNote: string | null };
  workTypeId: string;
  /** 最新一輪 */
  round: number;
  /** 最新一輪的驗收；待驗收時為 null */
  verdict: Verdict | null;
  /** 到期日（YYYY-MM-DD，#133）；沒有時是 null */
  dueAt: string | null;
  priority: Priority;
  /** 畫面標示的相對期限（shownRelativeDue()；已通過的不顯示） */
  due: RelativeDue;
  /** 最新一輪是抽查（#166）：只在待驗收的清單與驗收面板算出，其他情況是 false */
  spotCheck: boolean;
}

export interface WorkList {
  /** 待驗收：依交辦時間舊到新 */
  awaiting: WorkListItem[];
  /** 最近驗收過：依驗收時間新到舊，同時間依交辦 id；最多 RECENT_LIMIT 筆 */
  recent: WorkListItem[];
}

export interface EarlierRound {
  round: number;
  externalRef: string | null;
  summary: string;
  submittedAt: string;
  review: {
    verdict: Verdict;
    reason: ReturnReason | null;
    note: string | null;
    decidedAt: string;
    /** 退回時勾了「這個錯沒有被標成重點」（#168） */
    notInPoints: boolean;
    /** 逐條回饋（#168）：有標記的重點（依序號）與守則的文字和結果 */
    feedback: { text: string; result: PointResult | GuidelineResult }[];
  } | null;
}

export interface ReviewPanel {
  item: WorkListItem;
  focus: ReviewFocus;
  current: { id: string; round: number; externalRef: string | null; summary: string; submittedAt: string };
  /** 同一交辦的前幾輪，依輪次舊到新 */
  earlier: EarlierRound[];
  /** 能驗收的身分，且最新一輪還沒驗收 */
  canDecide: boolean;
  /** 最新一輪全文（目前語言）的解析結果；`focus.body.text` 是同一份原始全文，給退回純文字時用 */
  body: ParsedBody;
  /** 交件的種類，由工作類型決定；其他工作類型是 null */
  deliverable: Deliverable | null;
  /** 最新一輪已回流知識庫時，回流文件的第一段（#92；沒有回流或看不到時是 null） */
  knowledgePassage: string | null;
  /** 看重點時「為什麼是看重點」的依據（#102）；逐項看時是 null */
  light: LightReason | null;
  /** 最新一輪的變更（目前語言）：看重點時收成一行，「逐項列出」展開時用 */
  changeItems: WorkChange[];
  /** 最新一輪依照的守則（員工自述，#147）；沒有時是空陣列 */
  guidelines: FollowedGuideline[];
  /** 同一員工 × 工作類型等確認的守則數（#147）；不能驗收的身分是 0 */
  pendingGuidelines: number;
  /** 最新一輪的退回原因與「沒被標成重點」（#168）；不是退回時是 null */
  returned: { reason: ReturnReason; notInPoints: boolean } | null;
  /** 最新一輪已驗收時的逐條回饋（#168，getReviewDetails()）；待驗收時是 null */
  feedback: StoredFeedback | null;
  /** 最新一輪的驗收 id；待驗收時是 null */
  reviewId: string | null;
  /** 最新一輪（通過）的事後更正（#164）；沒有時是 null */
  correction: { correctedAt: string; note: string | null } | null;
  /** 能驗收的身分、最新一輪是通過、還沒有更正：可以記下事後更正 */
  canCorrect: boolean;
}

const EMPTY: WorkList = { awaiting: [], recent: [] };

/** 每個交辦最新一輪的 PR 編號與驗收時間（AssignmentSummary 沒有這兩項） */
interface LatestRow {
  assignmentId: string;
  workId: string;
  workRef: string | null;
  decidedAt: Date | null;
}

function readLatest(db: Database, identity: string): Promise<LatestRow[]> {
  return db.withIdentity(identity, async (tx) =>
    (
      await tx.query<LatestRow>(
        `SELECT DISTINCT ON (w.assignment_id) w.assignment_id AS "assignmentId", w.id AS "workId", w.external_ref AS "workRef", rv.decided_at AS "decidedAt"
         FROM crew.works w LEFT JOIN crew.reviews rv ON rv.work_id = w.id
         ORDER BY w.assignment_id, w.round DESC`,
      )
    ).rows,
  );
}

type Sortable = WorkListItem & { decidedAt: number; workId: string };

async function readItems(db: Database, identity: string, language: LanguageCode, today: string): Promise<Sortable[]> {
  const [assignments, employees, latest] = await Promise.all([
    listAssignments(db, identity),
    listEmployees(db, identity),
    readLatest(db, identity),
  ]);
  const names = new Map(employees.map((e) => [e.id, { displayName: e.displayName, roleNote: demoText("roleNote", e.id, language) ?? e.roleNote }]));
  const byAssignment = new Map(latest.map((l) => [l.assignmentId, l]));
  const items: Sortable[] = [];
  // listAssignments() 是新到舊；清單依交辦時間舊到新
  for (const a of [...assignments].reverse()) {
    const l = byAssignment.get(a.id);
    if (a.latestRound === null || !l) continue;
    items.push({ ...toItem(a, a.latestRound, l.workRef, names, language, today), decidedAt: l.decidedAt ? new Date(l.decidedAt).getTime() : 0, workId: l.workId });
  }
  return items;
}

type Names = Map<string, { displayName: string; roleNote: string | null }>;

function toItem(a: AssignmentSummary, round: number, workRef: string | null, names: Names, language: LanguageCode, today: string): WorkListItem {
  return {
    id: a.id,
    title: demoText("title", a.id, language) ?? a.title,
    sourceKind: a.sourceKind,
    sourceName: sourceLabel(a.sourceId, a.sourceName, language),
    externalRef: a.externalRef,
    workRef,
    employee: { id: a.employeeId, ...(names.get(a.employeeId) ?? { displayName: a.employeeId, roleNote: null }) },
    workTypeId: a.workTypeId,
    round,
    verdict: a.latestVerdict,
    dueAt: a.dueAt,
    priority: a.priority,
    due: shownRelativeDue(a.dueAt, today, a.latestVerdict === "accepted"),
    spotCheck: false,
  };
}

const strip = ({ decidedAt: _, workId: __, ...item }: Sortable): WorkListItem => item;

/** 待驗收的件標出抽查（#166）：依「員工 × 工作類型」各讀一次抽查（getTrustSummary()），最新一輪被抽到的標為 true */
async function markSpotChecks(db: Database, identity: string, items: Sortable[]): Promise<Sortable[]> {
  const spots = new Map<string, Promise<ReadonlySet<string>>>();
  const of = (i: Sortable) => {
    const key = `${i.employee.id}\u0000${i.workTypeId}`;
    if (!spots.has(key)) spots.set(key, getTrustSummary(db, identity, i.employee.id, i.workTypeId, DEMO_PARAMS).then((s) => new Set(s.spotChecks.keys())));
    return spots.get(key)!;
  };
  return Promise.all(items.map(async (i) => ({ ...i, spotCheck: (await of(i)).has(i.workId) })));
}

/**
 * `today` 是到期狀態的「今天」（YYYY-MM-DD）：預設是 demo 的 today，沒有時是目前的日期（#133）。
 * `pinned` 是要選取的交辦（#134：總覽點了較早完成的工作）：已驗收但不在最近 RECENT_LIMIT 筆時，接在「最近驗收過」的最後。
 */
export async function readWorkList(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  today: string = crewToday(DEMO),
  pinned: string | null = null,
): Promise<WorkList> {
  // 沒有身分時比照 guest：不讀取（與 readToday() 相同）
  if (identity === null) return EMPTY;
  const items = await readItems(db, identity, language, today);
  const reviewed = items
    .filter((i) => i.verdict !== null)
    .sort((x, y) => y.decidedAt - x.decidedAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const recent = reviewed.slice(0, RECENT_LIMIT);
  const extra = reviewed.slice(RECENT_LIMIT).find((i) => i.id === pinned);
  if (extra) recent.push(extra);
  const awaiting = await markSpotChecks(db, identity, items.filter((i) => i.verdict === null));
  return { awaiting: awaiting.map(strip), recent: recent.map(strip) };
}

/** 進入畫面時的選取：待驗收的第一筆；沒有待驗收時不選取（#39 的 `## 決定` 1） */
export const initialSelection = (list: WorkList): string | null => list.awaiting[0]?.id ?? null;

/** 驗收面板；看不到、不存在或還沒交件的交辦回傳 null。 */
export async function readReviewPanel(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  assignmentId: string,
  canReview: boolean,
  today: string = crewToday(DEMO),
): Promise<ReviewPanel | null> {
  if (identity === null) return null;
  const items = await readItems(db, identity, language, today);
  const found = items.find((i) => i.id === assignmentId);
  if (!found) return null;
  const item = strip(found);
  const works = (await getAssignmentWorks(db, identity, assignmentId)).map((w) => localize(w, language));
  const current = works.at(-1);
  if (!current) return null;
  const { inputs, spotChecks } = await getTrustSummary(db, identity, item.employee.id, item.workTypeId, DEMO_PARAMS);
  const { reviews, decisions, corrections } = inputs;
  const level = reviewLevel(reviews, decisions, corrections);
  const spotCheck = spotChecks.get(current.id) ?? null;
  const review = current.review;
  const accepted = review?.verdict === "accepted" ? review : null;
  const details = review ? await getReviewDetails(db, identity, review.id) : null;
  const stored = accepted && details?.correction;
  const correction = stored ? { correctedAt: stored.correctedAt, note: stored.note } : null;
  const [followed, all, earlier] = await Promise.all([
    listWorkGuidelines(db, identity, current.id),
    canReview ? listGuidelines(db, identity, { employeeId: item.employee.id, workTypeId: item.workTypeId }) : Promise.resolve([]),
    Promise.all(works.slice(0, -1).map((w) => earlierRound(db, identity, w, language))),
  ]);
  return {
    item: { ...item, spotCheck: spotCheck !== null },
    // 抽查（#161）：被抽到的那件逐項列出變更；面板以「這次抽查」卡片標示（#166）
    focus: reviewFocus(current, level, { spotCheck }),
    current: { id: current.id, round: current.round, externalRef: current.externalRef, summary: current.summary, submittedAt: current.submittedAt },
    earlier,
    canDecide: canReview && current.review === null,
    body: parseWorkBody(current.body, current.points.length),
    deliverable: deliverableOf(item.workTypeId),
    knowledgePassage: current.review?.verdict === "accepted" ? await readFlowbackPassage(db, identity, current.id) : null,
    light: level === "light" ? lightReason(reviews, decisions, DEMO_PARAMS.window) : null,
    changeItems: current.changes,
    guidelines: followedGuidelines(followed, current.submittedAt, language),
    pendingGuidelines: pendingGuidelineCount(all, canReview),
    returned: review?.verdict === "returned" ? { reason: review.reason, notInPoints: review.notInPoints } : null,
    feedback: details?.feedback ?? null,
    reviewId: review?.id ?? null,
    correction,
    canCorrect: canReview && accepted !== null && correction === null,
  };
}

/** 前幾輪的一輪：驗收的逐條回饋（#168）以重點與守則的文字列出（守則是交件當時的文字） */
async function earlierRound(db: Database, identity: string, w: StoredWork, language: LanguageCode): Promise<EarlierRound> {
  const base = { round: w.round, externalRef: w.externalRef, summary: w.summary, submittedAt: w.submittedAt };
  if (w.review === null) return { ...base, review: null };
  const { feedback } = await getReviewDetails(db, identity, w.review.id);
  const texts =
    feedback.guidelines.length === 0 ? new Map<string, string>() : new Map(followedGuidelines(await listWorkGuidelines(db, identity, w.id), w.submittedAt, language).map((g) => [g.id, g.text]));
  const { verdict, reason, note, decidedAt, notInPoints } = w.review;
  return {
    ...base,
    review: {
      verdict, reason, note, decidedAt, notInPoints,
      feedback: [
        ...feedback.points.map((p) => ({ text: w.points[p.ordinal - 1] ?? String(p.ordinal), result: p.result })),
        ...feedback.guidelines.map((g) => ({ text: texts.get(g.guidelineId) ?? g.guidelineId, result: g.result })),
      ],
    },
  };
}

/** 工作的文字換成目前語言；鍵是資料庫的工作 id（與 demoTextIndex() 相同） */
function localize(w: StoredWork, language: LanguageCode): StoredWork {
  return {
    ...w,
    summary: demoText("summary", w.id, language) ?? w.summary,
    // 原始全文（含標頭行與重點標記）：面板以 parseWorkBody() 依結構呈現（#72 計畫第 1 點）
    body: demoText("body", w.id, language) ?? w.body,
    points: w.points.map((p, i) => demoText("point", `${w.id}/${i + 1}`, language) ?? p),
    changes: w.changes.map((c, i) => ({ ...c, summary: demoText("change", `${w.id}/${i + 1}`, language) ?? c.summary })),
    // 退回的意見（#142）：鍵是驗收 id
    review: w.review && { ...w.review, note: w.review.note === null ? null : (demoText("reviewNote", w.review.id, language) ?? w.review.note) },
  };
}
