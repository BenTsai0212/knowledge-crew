// GitHub 的現況與時間軸 → 平台狀態（#110；對照表見 docs/crew/github-state.md）。
// 每次都從讀回的內容重新推出，不累加差異（#108 的 D6）；門檻的比對報表用同一個函式（D11）。
// 純函式：不呼叫 API、不讀資料庫、不產生介面文字。

import type { GhCheckRun, GhComment, GhIssue, GhPull, GhTimelineEvent } from "./types";

export type PlatformState =
  | "created" // 已建立、未派工
  | "ready" // 等待接手
  | "working" // 進行中
  | "plan-review" // 計畫待審
  | "blocked" // 員工停下、等決定
  | "delivered" // 已交件
  | "returned" // 已退回、修正中
  | "accepted" // 驗收通過
  | "void" // 作廢
  | "done" // 完成
  | "cancelled"; // 取消

export type WorkState = "delivered" | "returned" | "accepted" | "void";
export type CheckResult = "pass" | "fail" | "pending";
export type LinkKind = "closes" | "refs";
export type ReadFailure = "timeout" | "rate-limited" | "unauthorized" | "other";
export type MismatchCode = "working-without-start" | "timeline-differs";

export interface PullSnapshot {
  pull: GhPull;
  /** PR 的時間軸（`issues/{pr}/timeline`），用來推出 PR 標籤的變化 */
  timeline: GhTimelineEvent[];
  checkRuns: GhCheckRun[];
}

export interface IssueSnapshot {
  issue: GhIssue;
  timeline: GhTimelineEvent[];
  comments: GhComment[];
  /** 可能連到這張 Issue 的 PR；本文沒有 `Closes`／`Refs #N` 的會被略過 */
  pulls: PullSnapshot[];
}

export type ReadResult =
  | { ok: true; snapshot: IssueSnapshot; readAt: string }
  | { ok: false; reason: ReadFailure; attemptedAt: string; previous: GithubState | null };

export type StateFlag =
  | { kind: "possibly-stuck"; since: string }
  | { kind: "duplicate-start"; comments: number[] }
  | { kind: "duplicate-pulls"; pulls: number[] }
  | { kind: "split"; closes: number[]; refs: number[] }
  | { kind: "pending-todo" }
  | { kind: "read-failed"; reason: ReadFailure; at: string }
  | { kind: "needs-human"; codes: MismatchCode[] };

export interface CheckView {
  name: string;
  result: CheckResult;
}

export interface WorkView {
  pull: number;
  link: LinkKind;
  state: WorkState;
  checks: CheckView[];
}

export interface Transition {
  state: PlatformState;
  at: string;
}

export interface GithubState {
  issue: number | null;
  /** 讀回失敗且從沒讀到過時是 null */
  state: PlatformState | null;
  transitions: Transition[];
  works: WorkView[];
  flags: StateFlag[];
  /** 最後一次成功讀回的時間 */
  readAt: string | null;
}

/** 殘留的 `agent:working` 多久算「可能卡住」（decision-center.md 第 11 節第 2 項） */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const PASS = new Set(["success", "neutral", "skipped"]);

const time = (iso: string) => Date.parse(iso);

/** PR 本文怎麼連到 Issue `n`：同時有 `Closes` 與 `Refs` 時算 `closes` */
export function linkOf(body: string | null, n: number): LinkKind | null {
  const re = new RegExp(`\\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs)\\s*:?\\s+#${n}\\b`, "gi");
  let kind: LinkKind | null = null;
  for (const m of (body ?? "").matchAll(re)) {
    kind = m[1].toLowerCase() === "refs" && kind !== "closes" ? "refs" : "closes";
  }
  return kind;
}

/** 去掉重複並排成固定的順序（輸入的順序不影響結果） */
function normalizeEvents(events: GhTimelineEvent[]): GhTimelineEvent[] {
  const byKey = new Map<string, GhTimelineEvent>();
  for (const e of events) {
    byKey.set([e.id ?? "", e.event, e.created_at, e.label?.name ?? "", e.state_reason ?? ""].join("|"), e);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      time(a.created_at) - time(b.created_at) ||
      (a.id ?? 0) - (b.id ?? 0) ||
      a.event.localeCompare(b.event) ||
      (a.label?.name ?? "").localeCompare(b.label?.name ?? ""),
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => number): T[] {
  const map = new Map<number, T>();
  for (const item of items) if (!map.has(key(item))) map.set(key(item), item);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function labelsAt(events: GhTimelineEvent[], t: number): Set<string> {
  const labels = new Set<string>();
  for (const e of events) {
    if (time(e.created_at) > t || !e.label) continue;
    if (e.event === "labeled") labels.add(e.label.name);
    if (e.event === "unlabeled") labels.delete(e.label.name);
  }
  return labels;
}

/** 最後一次加上標籤的時間 */
function lastLabeled(events: GhTimelineEvent[], name: string): string | null {
  const hits = events.filter((e) => e.event === "labeled" && e.label?.name === name);
  return hits.length ? hits[hits.length - 1].created_at : null;
}

// 控制標題的中文關鍵字與全形括號（docs/workflow/headings.md）。這是流程格式的關鍵字，不是語言規則或介面文字；
// 以碼位寫出，原始碼不放中日韓字元（同 work/body.ts 的 MARK_OPEN）。
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const START = cp(0x958b, 0x5de5); // 開工
const PLAN = cp(0x8a08, 0x756b); // 計畫
const DECISION = cp(0x6c7a, 0x5b9a); // 決定
const OPEN = cp(0xff08);
const CLOSE = cp(0xff09);
const PLAN_WORDS = `${PLAN}|Plan`;
const CONTROL_WORDS = `${PLAN}|Plan|${DECISION}|Decision`;
const START_RE = new RegExp(`^##\\s*(?:${START}[${OPEN}(]#(\\d+)[${CLOSE})]|Started\\s*\\(#(\\d+)\\))`);

const heading = (body: string, words: string) =>
  new RegExp(`^##\\s*(?:${words})(?=[\\s${OPEN}(]|$)`).test(body.trimStart());

function isStart(c: GhComment, n: number): boolean {
  const m = START_RE.exec(c.body.trimStart());
  return m !== null && Number(m[1] ?? m[2]) === n;
}

interface PullAt {
  number: number;
  status: "open" | "merged" | "closed";
  labels: Set<string>;
  createdAt: number;
}

interface View {
  closed: "completed" | "not_planned" | null;
  labels: Set<string>;
  pulls: PullAt[];
  comments: GhComment[];
}

/** 對照表本身：一個時間點的事實 → 平台狀態（文件的「判斷順序」） */
function decide(v: View): PlatformState {
  if (v.closed) return v.closed === "not_planned" ? "cancelled" : "done";
  const open = v.pulls.filter((p) => p.status === "open");
  if (v.labels.has("blocked") || open.some((p) => p.labels.has("blocked"))) {
    const control = v.comments.filter((c) => heading(c.body, CONTROL_WORDS));
    const last = control[control.length - 1];
    const planWaiting = last !== undefined && heading(last.body, PLAN_WORDS);
    return v.labels.has("plan-first") && planWaiting ? "plan-review" : "blocked";
  }
  if (open.length) return open.some((p) => p.labels.has("changes-requested")) ? "returned" : "delivered";
  if (v.labels.has("agent:working")) return "working";
  if (v.labels.has("agent:ready")) return "ready";
  const latest = [...v.pulls].sort((a, b) => a.createdAt - b.createdAt || a.number - b.number).pop();
  if (latest) return latest.status === "merged" ? "accepted" : "void";
  return "created";
}

function checksOf(runs: GhCheckRun[]): CheckView[] {
  const latest = new Map<string, GhCheckRun>();
  for (const r of runs) {
    const seen = latest.get(r.name);
    if (!seen || r.id > seen.id) latest.set(r.name, r);
  }
  return [...latest.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({
      name: r.name,
      result: r.status !== "completed" ? "pending" : PASS.has(r.conclusion ?? "") ? "pass" : "fail",
    }));
}

function derive(s: IssueSnapshot, readAt: string, now: string): GithubState {
  const n = s.issue.number;
  const events = normalizeEvents(s.timeline);
  const comments = uniqueBy(s.comments, (c) => c.id)
    .filter((c) => TRUSTED.has(c.author_association))
    .sort((a, b) => time(a.created_at) - time(b.created_at) || a.id - b.id);
  const pulls = uniqueBy(s.pulls, (p) => p.pull.number)
    .map((p) => ({ ...p, link: linkOf(p.pull.body, n), events: normalizeEvents(p.timeline) }))
    .filter((p): p is typeof p & { link: LinkKind } => p.link !== null);

  const viewAt = (t: number): View => {
    let closed: View["closed"] = null;
    for (const e of events) {
      if (time(e.created_at) > t) break;
      if (e.event === "closed") closed = e.state_reason === "not_planned" ? "not_planned" : "completed";
      if (e.event === "reopened") closed = null;
    }
    const at = (iso: string | null) => iso !== null && time(iso) <= t;
    return {
      closed,
      labels: labelsAt(events, t),
      pulls: pulls
        .filter((p) => time(p.pull.created_at) <= t)
        .map((p) => ({
          number: p.pull.number,
          status: at(p.pull.merged_at) ? "merged" : at(p.pull.closed_at) ? "closed" : "open",
          labels: labelsAt(p.events, t),
          createdAt: time(p.pull.created_at),
        })),
      comments: comments.filter((c) => time(c.created_at) <= t),
    };
  };

  // 現況：以 GitHub 的現況欄位為準
  const labels = new Set(s.issue.labels.map((l) => l.name));
  const current: View = {
    closed: s.issue.state === "closed" ? (s.issue.state_reason === "not_planned" ? "not_planned" : "completed") : null,
    labels,
    pulls: pulls.map((p) => ({
      number: p.pull.number,
      status: p.pull.merged_at ? "merged" : p.pull.state === "closed" ? "closed" : "open",
      labels: new Set(p.pull.labels.map((l) => l.name)),
      createdAt: time(p.pull.created_at),
    })),
    comments,
  };
  const state = decide(current);

  // 轉換序列：在每個有事情發生的時間點重新推一次
  const times = new Set<number>([time(s.issue.created_at)]);
  for (const e of events) times.add(time(e.created_at));
  for (const c of comments) times.add(time(c.created_at));
  for (const p of pulls) {
    for (const iso of [p.pull.created_at, p.pull.merged_at, p.pull.closed_at]) if (iso) times.add(time(iso));
    for (const e of p.events) times.add(time(e.created_at));
  }
  const transitions: Transition[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const next = decide(viewAt(t));
    if (transitions[transitions.length - 1]?.state !== next) transitions.push({ state: next, at: new Date(t).toISOString() });
  }

  const works: WorkView[] = current.pulls.map((p, i) => ({
    pull: p.number,
    link: pulls[i].link,
    state: p.status === "merged" ? "accepted" : p.status === "closed" ? "void" : p.labels.has("changes-requested") ? "returned" : "delivered",
    checks: checksOf(pulls[i].checkRuns),
  }));

  // 已知狀況
  const flags: StateFlag[] = [];
  const openPulls = works.filter((w) => w.state === "delivered" || w.state === "returned").map((w) => w.pull);
  const workingSince = lastLabeled(events, "agent:working");
  if (labels.has("agent:working") && !openPulls.length && workingSince && time(now) - time(workingSince) > STUCK_AFTER_MS) {
    flags.push({ kind: "possibly-stuck", since: workingSince });
  }
  const readyAt = lastLabeled(events, "agent:ready");
  const starts = comments.filter((c) => isStart(c, n) && (readyAt === null || time(c.created_at) >= time(readyAt)));
  if (starts.length >= 2) flags.push({ kind: "duplicate-start", comments: starts.map((c) => c.id).sort((a, b) => a - b) });
  if (openPulls.length >= 2) flags.push({ kind: "duplicate-pulls", pulls: openPulls });
  if (works.some((w) => w.link === "refs")) {
    const of = (link: LinkKind) => works.filter((w) => w.link === link).map((w) => w.pull);
    flags.push({ kind: "split", closes: of("closes"), refs: of("refs") });
  }
  if (state === "done" && labels.has("needs-human")) flags.push({ kind: "pending-todo" });
  const codes: MismatchCode[] = [];
  if (labels.has("agent:working") && !starts.length) codes.push("working-without-start");
  if (transitions[transitions.length - 1].state !== state) codes.push("timeline-differs");
  if (codes.length) flags.push({ kind: "needs-human", codes });

  return { issue: n, state, transitions, works, flags, readAt };
}

/** 讀回的結果 → 平台狀態。讀回失敗時沿用上一次的結果，只加上 `read-failed` */
export function deriveGithubState(read: ReadResult, now: string): GithubState {
  if (read.ok) return derive(read.snapshot, read.readAt, now);
  const failed: StateFlag = { kind: "read-failed", reason: read.reason, at: read.attemptedAt };
  if (!read.previous) return { issue: null, state: null, transitions: [], works: [], flags: [failed], readAt: null };
  return { ...read.previous, flags: [...read.previous.flags.filter((f) => f.kind !== "read-failed"), failed] };
}
