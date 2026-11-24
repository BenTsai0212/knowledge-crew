// 「總覽」畫面的資料整理（#134）：專案卡片、篩選與工作看板。讀取一律經 db.withIdentity()，可見範圍由 RLS 決定；
// 狀態與需注意的標記由 work/status.ts 推算。不呈現績效：不排名員工、不比較產量。
import type { AccessFile, LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import type { Priority } from "../db/store";
import { DEMO } from "../demo/load";
import { demoText } from "../demo/texts";
import type { Verdict } from "../trust/types";
import { crewToday, shownDueStatus, type DueStatus } from "../work/due";
import { attentionFlags, needsAttention, stayDays, WORK_STATUSES, workStatus, type AttentionFlags, type WorkStatus } from "../work/status";
import { sourceLabel } from "./refs";

/** 欄位一開始顯示的件數（待交件、等驗收、修正中）；超過時加「顯示全部」 */
export const COLUMN_LIMIT = 5;
/** 已完成欄一開始顯示的件數（最近完成的） */
export const DONE_LIMIT = 3;

export interface OverviewItem {
  id: string;
  title: string;
  employee: { id: string; displayName: string };
  workTypeId: string;
  projectId: string;
  status: WorkStatus;
  /** 最新一輪；沒有交件時是 null */
  round: number | null;
  dueAt: string | null;
  priority: Priority;
  /** 畫面標示的到期狀態（已完成的不標逾期與即將到期） */
  due: DueStatus;
  flags: AttentionFlags;
  /** 在目前狀態停留的天數；已完成是 null */
  stayDays: number | null;
  /** 等驗收且最新一輪有檢查沒通過 */
  checkFailed: boolean;
  /** 已完成的時間（ISO）；其他狀態是 null */
  doneAt: string | null;
}

export interface ProjectSummary {
  id: string;
  label: string;
  /** 看得到的工作來源（目前語言） */
  sources: string[];
  total: number;
  counts: Record<WorkStatus, number>;
  attention: { overdue: number; soon: number; stalled: number };
  /** 回流知識庫的筆數 */
  knowledge: number;
}

export interface Overview {
  projects: ProjectSummary[];
  items: OverviewItem[];
}

export const EMPTY_OVERVIEW: Overview = { projects: [], items: [] };

export interface OverviewFilter {
  projectId: string | null;
  employeeId: string | null;
  workTypeId: string | null;
  attentionOnly: boolean;
}

export const NO_FILTER: OverviewFilter = { projectId: null, employeeId: null, workTypeId: null, attentionOnly: false };

export const isFiltered = (f: OverviewFilter) => f.projectId !== null || f.employeeId !== null || f.workTypeId !== null || f.attentionOnly;

export interface OverviewRow {
  id: string;
  title: string;
  employeeId: string;
  employeeName: string;
  workTypeId: string;
  projectId: string;
  assignedAt: string;
  dueAt: string | null;
  priority: Priority;
  latestRound: number | null;
  latestSubmittedAt: string | null;
  latestVerdict: Verdict | null;
  latestDecidedAt: string | null;
  checkFailed: boolean;
}

/** 資料列 → 看板的工作（純函式；today 是 YYYY-MM-DD） */
export function toOverviewItem(row: OverviewRow, today: string): OverviewItem {
  const status = workStatus(row);
  const done = status === "done";
  return {
    id: row.id,
    title: row.title,
    employee: { id: row.employeeId, displayName: row.employeeName },
    workTypeId: row.workTypeId,
    projectId: row.projectId,
    status,
    round: row.latestRound,
    dueAt: row.dueAt,
    priority: row.priority,
    due: shownDueStatus(row.dueAt, today, done),
    flags: attentionFlags(row, today),
    stayDays: done ? null : stayDays(row, today),
    checkFailed: status === "awaiting" && row.checkFailed,
    doneAt: done ? row.latestDecidedAt : null,
  };
}

/** 專案卡片（純函式）：每個看得到的專案一張，依 access.json 的順序；沒有工作的專案件數都是 0。 */
export function summarizeProjects(
  projects: readonly { id: string; label: string; sources: string[] }[],
  items: readonly OverviewItem[],
  knowledge: ReadonlyMap<string, number>,
): ProjectSummary[] {
  return projects.map((p) => {
    const mine = items.filter((i) => i.projectId === p.id);
    const counts = Object.fromEntries(WORK_STATUSES.map((s) => [s, mine.filter((i) => i.status === s).length])) as Record<WorkStatus, number>;
    return {
      ...p,
      total: mine.length,
      counts,
      attention: {
        overdue: mine.filter((i) => i.flags.overdue).length,
        soon: mine.filter((i) => i.flags.soon).length,
        stalled: mine.filter((i) => i.flags.stalled).length,
      },
      knowledge: knowledge.get(p.id) ?? 0,
    };
  });
}

export function filterItems(items: readonly OverviewItem[], f: OverviewFilter): OverviewItem[] {
  return items.filter(
    (i) =>
      (f.projectId === null || i.projectId === f.projectId) &&
      (f.employeeId === null || i.employee.id === f.employeeId) &&
      (f.workTypeId === null || i.workTypeId === f.workTypeId) &&
      (!f.attentionOnly || needsAttention(i.flags)),
  );
}

const DUE_NONE = "9999-12-31";
const byId = (a: OverviewItem, b: OverviewItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 進行中的欄位：逾期 → 優先順序高 → 到期日近（沒有到期日排後面）→ 停留久 → id */
export function compareActive(a: OverviewItem, b: OverviewItem): number {
  return (
    Number(b.flags.overdue) - Number(a.flags.overdue) ||
    Number(b.priority === "high") - Number(a.priority === "high") ||
    (a.dueAt ?? DUE_NONE).localeCompare(b.dueAt ?? DUE_NONE) ||
    (b.stayDays ?? 0) - (a.stayDays ?? 0) ||
    byId(a, b)
  );
}

/** 已完成欄：最近完成的在前（一開始只顯示最近幾件）；已完成沒有逾期與停留天數可排 */
export const compareDone = (a: OverviewItem, b: OverviewItem): number => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || byId(a, b);

/** 看板：四欄，各自排序 */
export function boardColumns(items: readonly OverviewItem[]): Record<WorkStatus, OverviewItem[]> {
  return Object.fromEntries(
    WORK_STATUSES.map((s) => [s, items.filter((i) => i.status === s).sort(s === "done" ? compareDone : compareActive)]),
  ) as Record<WorkStatus, OverviewItem[]>;
}

export const columnLimit = (status: WorkStatus) => (status === "done" ? DONE_LIMIT : COLUMN_LIMIT);

/** 篩選列的選項：看板上出現過的員工（依名稱）與工作類型（依出現順序的 id 排序） */
export function overviewOptions(items: readonly OverviewItem[]): { employees: { id: string; displayName: string }[]; workTypes: string[] } {
  const employees = new Map(items.map((i) => [i.employee.id, i.employee]));
  return {
    employees: [...employees.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    workTypes: [...new Set(items.map((i) => i.workTypeId))].sort(),
  };
}

// ---- 讀取 ----

interface Row extends Omit<OverviewRow, "assignedAt" | "latestSubmittedAt" | "latestDecidedAt"> {
  assignedAt: Date | string;
  latestSubmittedAt: Date | string | null;
  latestDecidedAt: Date | string | null;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

const ITEMS_SQL = `SELECT a.id, a.title, a.employee_id AS "employeeId", e.display_name AS "employeeName", a.work_type_id AS "workTypeId",
    s.project_id AS "projectId", a.assigned_at AS "assignedAt", to_char(a.due_at, 'YYYY-MM-DD') AS "dueAt", a.priority,
    lw.round AS "latestRound", lw.submitted_at AS "latestSubmittedAt", rv.verdict AS "latestVerdict", rv.decided_at AS "latestDecidedAt",
    COALESCE((
      SELECT bool_or(c.status = 'fail') FROM (
        SELECT DISTINCT ON (name) status FROM crew.work_checks WHERE work_id = lw.id ORDER BY name, checked_at DESC, id DESC
      ) c
    ), false) AS "checkFailed"
  FROM crew.assignments a
  JOIN crew.sources s ON s.id = a.source_id
  JOIN crew.employees e ON e.id = a.employee_id
  LEFT JOIN LATERAL (
    SELECT w.id, w.round, w.submitted_at FROM crew.works w WHERE w.assignment_id = a.id ORDER BY w.round DESC LIMIT 1
  ) lw ON true
  LEFT JOIN crew.reviews rv ON rv.work_id = lw.id
  ORDER BY a.assigned_at, a.id`;

const KNOWLEDGE_SQL = `SELECT s.project_id AS "projectId", count(*)::int AS "count"
  FROM crew.knowledge_flowbacks f
  JOIN crew.reviews rv ON rv.id = f.review_id
  JOIN crew.works w ON w.id = rv.work_id
  JOIN crew.assignments a ON a.id = w.assignment_id
  JOIN crew.sources s ON s.id = a.source_id
  GROUP BY s.project_id`;

/**
 * 總覽：目前身分看得到的專案與工作。沒有身分時比照 guest（不讀取）。
 * `today` 預設是 demo 的 today（沒有時是目前的日期），與到期日相同（#133）。
 */
export async function readOverview(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  access: Pick<AccessFile, "projects">,
  today: string = crewToday(DEMO),
): Promise<Overview> {
  if (identity === null) return EMPTY_OVERVIEW;
  const { rows, sources, knowledge } = await db.withIdentity(identity, async (tx) => ({
    rows: (await tx.query<Row>(ITEMS_SQL)).rows,
    sources: (await tx.query<{ id: string; name: string; projectId: string }>(`SELECT id, name, project_id AS "projectId" FROM crew.sources ORDER BY name`)).rows,
    knowledge: (await tx.query<{ projectId: string; count: number }>(KNOWLEDGE_SQL)).rows,
  }));
  const items = rows.map((r) =>
    toOverviewItem(
      {
        ...r,
        title: demoText("title", r.id, language) ?? r.title,
        assignedAt: iso(r.assignedAt)!,
        latestSubmittedAt: iso(r.latestSubmittedAt),
        latestDecidedAt: iso(r.latestDecidedAt),
      },
      today,
    ),
  );
  const projects = access.projects
    .map((p) => ({
      id: p.id,
      label: p.label[language] ?? p.id,
      sources: sources.filter((s) => s.projectId === p.id).map((s) => sourceLabel(s.id, s.name, language)),
    }))
    .filter((p) => p.sources.length > 0);
  return { projects: summarizeProjects(projects, items, new Map(knowledge.map((k) => [k.projectId, k.count]))), items };
}
