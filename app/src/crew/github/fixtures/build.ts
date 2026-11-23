// 測試用的假 GitHub 回應：形狀同 GitHub REST API，內容全部虛構（#110）。
import type { GhCheckRun, GhComment, GhTimelineEvent } from "../types";
import type { IssueSnapshot, PullSnapshot } from "../state";
import lifecycleJson from "./lifecycle.json";

export const ISSUE = 7;

/** 完整的一輪：建立 → 派工 → 開工 → 交件 → 退回 → 修正 → 合併並關閉 */
export const lifecycle = lifecycleJson as IssueSnapshot;

/** `2026-01-05` 的 `hh:mm`（UTC） */
export const at = (hhmm: string) => `2026-01-05T${hhmm}:00Z`;

let nextId = 1000;

export const labeled = (hhmm: string, name: string, event = "labeled"): GhTimelineEvent => ({
  id: nextId++,
  event,
  created_at: at(hhmm),
  label: { name },
});

export const unlabeled = (hhmm: string, name: string) => labeled(hhmm, name, "unlabeled");

export const closed = (hhmm: string, state_reason: "completed" | "not_planned"): GhTimelineEvent => ({
  id: nextId++,
  event: "closed",
  created_at: at(hhmm),
  state_reason,
});

export const comment = (hhmm: string, body: string, author_association: GhComment["author_association"] = "OWNER"): GhComment => ({
  id: nextId++,
  body,
  created_at: at(hhmm),
  user: { login: "example-owner" },
  author_association,
});

/** 開工留言：本文取自 `lifecycle.json`（原始碼不放中日韓字元，見 client/i18n.test.ts），只換 session */
const START_BODY = lifecycle.comments[0].body;
export const start = (hhmm: string, session = "cse_example") => comment(hhmm, START_BODY.replace("cse_example0001", session));

/** 一張還開著的 Issue；`labels` 是現況，`timeline` 是時間軸 */
export function openIssue(labels: string[], timeline: GhTimelineEvent[], comments: GhComment[] = [], pulls: PullSnapshot[] = []): IssueSnapshot {
  return {
    issue: { number: ISSUE, state: "open", state_reason: null, labels: labels.map((name) => ({ name })), created_at: at("01:00"), closed_at: null },
    timeline,
    comments,
    pulls,
  };
}

export function pull(
  number: number,
  opts: { body?: string; created: string; merged?: string; closed?: string; labels?: string[]; timeline?: GhTimelineEvent[]; checkRuns?: GhCheckRun[] },
): PullSnapshot {
  const closedAt = opts.merged ?? opts.closed ?? null;
  return {
    pull: {
      number,
      state: closedAt ? "closed" : "open",
      body: opts.body ?? `Closes #${ISSUE}`,
      created_at: at(opts.created),
      closed_at: closedAt ? at(closedAt) : null,
      merged_at: opts.merged ? at(opts.merged) : null,
      labels: (opts.labels ?? []).map((name) => ({ name })),
      head: { sha: String(number).padStart(40, "0") },
    },
    timeline: opts.timeline ?? [],
    checkRuns: opts.checkRuns ?? [],
  };
}
