// 「工作與驗收」畫面的資料整理（#39 計畫第 3 節）：工作清單與驗收面板。讀取經 store.ts 與本檔的查詢，
// 一律經 db.withIdentity()，可見範圍由 RLS 決定。資料庫的文字以 demoText() 換成目前語言，找不到時用原文。
// 層級只由 reviewLevel() 決定，面板只依 reviewFocus() 的結果呈現。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { getAssignmentWorks, getTrustInputs, listAssignments, listEmployees, type AssignmentSummary, type StoredWork } from "../db/store";
import { demoText } from "../demo/texts";
import { reviewFocus, reviewLevel } from "../trust/rules";
import type { ReturnReason, ReviewFocus, Verdict } from "../trust/types";

/** 「最近驗收過」最多幾筆（#39 的 `## 決定` 2） */
export const RECENT_LIMIT = 10;

export interface WorkListItem {
  id: string;
  title: string;
  sourceName: string;
  externalRef: string | null;
  /** 最新一輪的 PR 編號 */
  workRef: string | null;
  employee: { id: string; displayName: string };
  workTypeId: string;
  /** 最新一輪 */
  round: number;
  /** 最新一輪的驗收；待驗收時為 null */
  verdict: Verdict | null;
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
  review: { verdict: Verdict; reason: ReturnReason | null; note: string | null; decidedAt: string } | null;
}

export interface ReviewPanel {
  item: WorkListItem;
  focus: ReviewFocus;
  current: { id: string; round: number; externalRef: string | null; summary: string; submittedAt: string };
  /** 同一交辦的前幾輪，依輪次舊到新 */
  earlier: EarlierRound[];
  /** 能驗收的身分，且最新一輪還沒驗收 */
  canDecide: boolean;
}

const EMPTY: WorkList = { awaiting: [], recent: [] };

/** 每個交辦最新一輪的 PR 編號與驗收時間（AssignmentSummary 沒有這兩項） */
interface LatestRow {
  assignmentId: string;
  workRef: string | null;
  decidedAt: Date | null;
}

function readLatest(db: Database, identity: string): Promise<LatestRow[]> {
  return db.withIdentity(identity, async (tx) =>
    (
      await tx.query<LatestRow>(
        `SELECT DISTINCT ON (w.assignment_id) w.assignment_id AS "assignmentId", w.external_ref AS "workRef", rv.decided_at AS "decidedAt"
         FROM crew.works w LEFT JOIN crew.reviews rv ON rv.work_id = w.id
         ORDER BY w.assignment_id, w.round DESC`,
      )
    ).rows,
  );
}

type Sortable = WorkListItem & { decidedAt: number };

async function readItems(db: Database, identity: string, language: LanguageCode): Promise<Sortable[]> {
  const [assignments, employees, latest] = await Promise.all([
    listAssignments(db, identity),
    listEmployees(db, identity),
    readLatest(db, identity),
  ]);
  const names = new Map(employees.map((e) => [e.id, e.displayName]));
  const byAssignment = new Map(latest.map((l) => [l.assignmentId, l]));
  const items: Sortable[] = [];
  // listAssignments() 是新到舊；清單依交辦時間舊到新
  for (const a of [...assignments].reverse()) {
    const l = byAssignment.get(a.id);
    if (a.latestRound === null || !l) continue;
    items.push({ ...toItem(a, a.latestRound, l.workRef, names, language), decidedAt: l.decidedAt ? new Date(l.decidedAt).getTime() : 0 });
  }
  return items;
}

function toItem(a: AssignmentSummary, round: number, workRef: string | null, names: Map<string, string>, language: LanguageCode): WorkListItem {
  return {
    id: a.id,
    title: demoText("title", a.id, language) ?? a.title,
    sourceName: a.sourceName,
    externalRef: a.externalRef,
    workRef,
    employee: { id: a.employeeId, displayName: names.get(a.employeeId) ?? a.employeeId },
    workTypeId: a.workTypeId,
    round,
    verdict: a.latestVerdict,
  };
}

const strip = ({ decidedAt: _, ...item }: Sortable): WorkListItem => item;

export async function readWorkList(db: Database, identity: string | null, language: LanguageCode): Promise<WorkList> {
  // 沒有身分時比照 guest：不讀取（與 readToday() 相同）
  if (identity === null) return EMPTY;
  const items = await readItems(db, identity, language);
  const recent = items
    .filter((i) => i.verdict !== null)
    .sort((x, y) => y.decidedAt - x.decidedAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, RECENT_LIMIT);
  return { awaiting: items.filter((i) => i.verdict === null).map(strip), recent: recent.map(strip) };
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
): Promise<ReviewPanel | null> {
  if (identity === null) return null;
  const items = await readItems(db, identity, language);
  const found = items.find((i) => i.id === assignmentId);
  if (!found) return null;
  const item = strip(found);
  const works = (await getAssignmentWorks(db, identity, assignmentId)).map((w) => localize(w, language));
  const current = works.at(-1);
  if (!current) return null;
  const { reviews, decisions } = await getTrustInputs(db, identity, item.employee.id, item.workTypeId);
  return {
    item,
    focus: reviewFocus(current, reviewLevel(reviews, decisions)),
    current: { id: current.id, round: current.round, externalRef: current.externalRef, summary: current.summary, submittedAt: current.submittedAt },
    earlier: works.slice(0, -1).map((w) => ({
      round: w.round,
      externalRef: w.externalRef,
      summary: w.summary,
      submittedAt: w.submittedAt,
      review: w.review && { verdict: w.review.verdict, reason: w.review.reason, note: w.review.note, decidedAt: w.review.decidedAt },
    })),
    canDecide: canReview && current.review === null,
  };
}

/** 工作的文字換成目前語言；鍵是資料庫的工作 id（與 demoTextIndex() 相同） */
function localize(w: StoredWork, language: LanguageCode): StoredWork {
  return {
    ...w,
    summary: demoText("summary", w.id, language) ?? w.summary,
    body: demoText("body", w.id, language) ?? w.body,
    points: w.points.map((p, i) => demoText("point", `${w.id}/${i + 1}`, language) ?? p),
    changes: w.changes.map((c, i) => ({ ...c, summary: demoText("change", `${w.id}/${i + 1}`, language) ?? c.summary })),
  };
}
