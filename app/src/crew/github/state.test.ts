import { describe, expect, it } from "vitest";
import { deriveGithubState, linkOf, type GithubState, type IssueSnapshot } from "./state";
import { at, closed, comment, ISSUE, labeled, lifecycle, openIssue, pull, start, unlabeled } from "./fixtures/build";

const NOW = at("06:30");
const read = (snapshot: IssueSnapshot, now = NOW) => deriveGithubState({ ok: true, snapshot, readAt: now }, now);
const kinds = (s: GithubState) => s.flags.map((f) => f.kind);
const dispatched = [labeled("01:00", "type:feat"), labeled("01:01", "agent:ready"), unlabeled("01:02", "agent:ready"), labeled("01:02", "agent:working")];

describe("對照表（docs/crew/github-state.md）", () => {
  it("已建立、未派工：沒有 agent:ready", () => {
    const s = read(openIssue(["type:feat"], [labeled("01:00", "type:feat")]));
    expect(s.state).toBe("created");
    expect(s.flags).toEqual([]);
  });

  it("等待接手：有 agent:ready", () => {
    expect(read(openIssue(["agent:ready"], [labeled("01:01", "agent:ready")])).state).toBe("ready");
  });

  it("進行中：有 agent:working 與開工留言", () => {
    const s = read(openIssue(["type:feat", "agent:working"], dispatched, [start("01:03")]), at("01:30"));
    expect(s.state).toBe("working");
    expect(s.transitions.map((t) => t.state)).toEqual(["created", "ready", "working"]);
    expect(s.flags).toEqual([]);
  });

  it("計畫待審：plan-first＋blocked，最後的控制留言是 ## 計畫", () => {
    const timeline = [labeled("01:00", "plan-first"), labeled("01:01", "agent:ready"), labeled("02:01", "blocked")];
    const s = read(openIssue(["plan-first", "blocked"], timeline, [comment("02:00", "## 計畫（#7）\n\n…")]));
    expect(s.state).toBe("plan-review");
    expect(s.transitions.map((t) => t.state)).toEqual(["created", "ready", "plan-review"]);
  });

  it("員工停下：blocked（沒有 plan-first、計畫之後已有決定，或 PR 帶 blocked）", () => {
    expect(read(openIssue(["blocked"], [labeled("02:00", "blocked")], [comment("01:59", "## 計畫")])).state).toBe("blocked");
    const decided = [comment("02:00", "## 計畫（#7）"), comment("03:00", "## 決定\n\n同意")];
    expect(read(openIssue(["plan-first", "blocked"], [labeled("03:01", "blocked")], decided)).state).toBe("blocked");
    expect(read(openIssue([], [], [], [pull(8, { created: "02:00", labels: ["blocked"] })])).state).toBe("blocked");
  });

  it("已交件：有連到 Issue 的開啟中 PR", () => {
    const s = read(openIssue([], dispatched.concat(unlabeled("02:00", "agent:working")), [start("01:03")], [pull(8, { created: "02:00" })]));
    expect(s.state).toBe("delivered");
    expect(s.works).toEqual([{ pull: 8, link: "closes", state: "delivered", checks: [] }]);
  });

  it("檢查：同名取最新一次，未完成是 pending，success／neutral／skipped 算通過", () => {
    const checkRuns = [
      { id: 1, name: "checks", status: "completed", conclusion: "success" },
      { id: 2, name: "checks", status: "completed", conclusion: "failure" },
      { id: 3, name: "e2e", status: "in_progress", conclusion: null },
      { id: 4, name: "clients", status: "completed", conclusion: "neutral" },
    ] as const;
    const s = read(openIssue([], [], [], [pull(8, { created: "02:00", checkRuns: [...checkRuns] })]));
    expect(s.works[0].checks).toEqual([
      { name: "checks", result: "fail" },
      { name: "clients", result: "pass" },
      { name: "e2e", result: "pending" },
    ]);
  });

  it("已退回、修正中：PR 帶 changes-requested", () => {
    const p = pull(8, { created: "02:00", labels: ["changes-requested"], timeline: [labeled("03:00", "changes-requested")] });
    const s = read(openIssue([], [], [], [p]));
    expect(s.state).toBe("returned");
    expect(s.works[0].state).toBe("returned");
    expect(s.transitions.map((t) => t.state)).toEqual(["created", "delivered", "returned"]);
  });

  it("驗收通過：PR 合併（Refs 的 PR，Issue 仍開著）", () => {
    const s = read(openIssue([], [], [], [pull(8, { body: "Refs #7", created: "02:00", merged: "03:00" })]));
    expect(s.state).toBe("accepted");
    expect(s.works[0]).toMatchObject({ link: "refs", state: "accepted" });
  });

  it("作廢：PR 未合併就關閉", () => {
    const s = read(openIssue([], [], [], [pull(8, { created: "02:00", closed: "03:00" })]));
    expect(s.state).toBe("void");
    expect(s.works[0].state).toBe("void");
  });

  it("完成：Issue 以 completed 關閉；needs-human 未清時標示合併後待辦", () => {
    const s = read(lifecycle);
    expect(s.state).toBe("done");
    expect(kinds(s)).toEqual([]);
    const todo = structuredClone(lifecycle);
    todo.issue.labels.push({ name: "needs-human" });
    expect(kinds(read(todo))).toEqual(["pending-todo"]);
  });

  it("取消：Issue 以 not_planned 關閉", () => {
    const snap = openIssue([], [closed("02:00", "not_planned")]);
    snap.issue = { ...snap.issue, state: "closed", state_reason: "not_planned", closed_at: at("02:00") };
    const s = read(snap);
    expect(s.state).toBe("cancelled");
    expect(s.transitions.map((t) => t.state)).toEqual(["created", "cancelled"]);
  });
});

describe("轉換序列", () => {
  it("完整的一輪", () => {
    expect(read(lifecycle).transitions).toEqual([
      { state: "created", at: "2026-01-05T01:00:00.000Z" },
      { state: "ready", at: "2026-01-05T01:01:00.000Z" },
      { state: "working", at: "2026-01-05T01:02:00.000Z" },
      { state: "delivered", at: "2026-01-05T02:00:00.000Z" },
      { state: "returned", at: "2026-01-05T03:00:00.000Z" },
      { state: "delivered", at: "2026-01-05T04:00:00.000Z" },
      { state: "done", at: "2026-01-05T06:00:00.000Z" },
    ]);
    expect(read(lifecycle).works).toEqual([
      { pull: 8, link: "closes", state: "accepted", checks: [{ name: "checks", result: "pass" }, { name: "e2e", result: "pass" }] },
    ]);
  });

  it("時間軸、留言、PR 的順序打亂或重複時，結果相同", () => {
    const expected = read(lifecycle);
    const shuffled: IssueSnapshot = {
      ...lifecycle,
      timeline: [...lifecycle.timeline].reverse().concat(lifecycle.timeline.slice(0, 3)),
      comments: lifecycle.comments.concat(lifecycle.comments),
      pulls: [lifecycle.pulls[0], { ...lifecycle.pulls[0], timeline: [...lifecycle.pulls[0].timeline].reverse(), checkRuns: [...lifecycle.pulls[0].checkRuns].reverse() }],
    };
    expect(read(shuffled)).toEqual(expected);
    const split = openIssue([], [], [], [pull(9, { body: "Refs #7", created: "03:00" }), pull(8, { body: "Refs #7", created: "02:00" })]);
    expect(read({ ...split, pulls: [...split.pulls].reverse() })).toEqual(read(split));
  });

  it("本文沒有連到這張 Issue 的 PR 不算", () => {
    expect(read(openIssue([], [], [], [pull(8, { body: "Closes #70", created: "02:00" })])).state).toBe("created");
  });
});

describe("已知狀況", () => {
  it("可能卡住：agent:working 超過 2 小時、沒有開啟中的 PR", () => {
    const snap = openIssue(["agent:working"], dispatched, [start("01:03")]);
    expect(read(snap, at("03:02")).flags).toEqual([]);
    expect(read(snap, at("03:03")).flags).toEqual([{ kind: "possibly-stuck", since: at("01:02") }]);
    const withPull = { ...snap, pulls: [pull(8, { created: "02:00" })] };
    expect(kinds(read(withPull, at("05:00")))).not.toContain("possibly-stuck");
  });

  it("重複開工：這次 agent:ready 之後有 2 則開工留言（之前的派工不算）", () => {
    const comments = [start("00:30", "cse_old"), start("01:03", "cse_a"), start("01:04", "cse_b")];
    const s = read(openIssue(["agent:working"], dispatched, comments), at("01:30"));
    expect(s.flags).toEqual([{ kind: "duplicate-start", comments: [comments[1].id, comments[2].id] }]);
    expect(read(openIssue(["agent:working"], dispatched, comments.slice(0, 2)), at("01:30")).flags).toEqual([]);
  });

  it("重複開工：2 個以上連到 Issue 的開啟中 PR，都列出", () => {
    const s = read(openIssue([], [], [], [pull(9, { created: "02:05" }), pull(8, { created: "02:00" })]));
    expect(s.flags).toEqual([{ kind: "duplicate-pulls", pulls: [8, 9] }]);
  });

  it("拆成多個 PR：列出 Closes 與 Refs", () => {
    const pulls = [pull(8, { body: "Refs #7", created: "02:00", merged: "02:30" }), pull(9, { body: "Closes #7", created: "03:00" })];
    const s = read(openIssue([], [], [], pulls));
    expect(s.state).toBe("delivered");
    expect(s.flags).toEqual([{ kind: "split", closes: [9], refs: [8] }]);
  });

  it("讀回失敗：沿用上一次的結果，只加上 read-failed", () => {
    const previous = read(lifecycle);
    const failed = deriveGithubState({ ok: false, reason: "rate-limited", attemptedAt: at("07:00"), previous }, at("07:00"));
    expect(failed).toEqual({ ...previous, flags: [{ kind: "read-failed", reason: "rate-limited", at: at("07:00") }] });
    const again = deriveGithubState({ ok: false, reason: "timeout", attemptedAt: at("07:10"), previous: failed }, at("07:10"));
    expect(again.flags).toEqual([{ kind: "read-failed", reason: "timeout", at: at("07:10") }]);
    expect(again.readAt).toBe(NOW);
    const never = deriveGithubState({ ok: false, reason: "unauthorized", attemptedAt: at("07:00"), previous: null }, at("07:00"));
    expect(never).toMatchObject({ issue: null, state: null, readAt: null, flags: [{ kind: "read-failed" }] });
  });

  it("對不上：agent:working 卻沒有開工留言，標示需要人看", () => {
    const s = read(openIssue(["agent:working"], dispatched), at("01:30"));
    expect(s.state).toBe("working");
    expect(s.flags).toEqual([{ kind: "needs-human", codes: ["working-without-start"] }]);
  });

  it("對不上：時間軸推出的狀態與現況不同", () => {
    const s = read(openIssue(["agent:ready"], []));
    expect(s.state).toBe("ready");
    expect(s.flags).toEqual([{ kind: "needs-human", codes: ["timeline-differs"] }]);
  });

  it("不可信身分的留言不算開工留言，也不算計畫", () => {
    const s = read(openIssue(["agent:working"], dispatched, [comment("01:03", `## 開工（#${ISSUE}）`, "NONE")]), at("01:30"));
    expect(s.flags).toEqual([{ kind: "needs-human", codes: ["working-without-start"] }]);
    const plan = read(openIssue(["plan-first", "blocked"], [labeled("02:01", "blocked")], [comment("02:00", "## 計畫", "CONTRIBUTOR")]));
    expect(plan.state).toBe("blocked");
  });
});

describe("控制標題", () => {
  it("英文的 ## Started (#N)、## Plan、## Decision 也認得；別張 Issue 的開工留言不算", () => {
    const s = read(openIssue(["agent:working"], dispatched, [comment("01:03", "## Started (#7)"), comment("01:04", "## 開工（#70）")]), at("01:30"));
    expect(s.flags).toEqual([]);
    const timeline = [labeled("01:00", "plan-first"), labeled("02:01", "blocked")];
    expect(read(openIssue(["plan-first", "blocked"], timeline, [comment("02:00", "## Plan (#7)")])).state).toBe("plan-review");
    const decided = [comment("02:00", "## Plan"), comment("03:00", "## Decision")];
    expect(read(openIssue(["plan-first", "blocked"], timeline, decided)).state).toBe("blocked");
    expect(read(openIssue(["plan-first", "blocked"], timeline, [comment("02:00", "## 計畫書")])).state).toBe("blocked");
  });
});

describe("linkOf", () => {
  it("Closes／Fixes／Resolves 是 closes，Refs 是 refs，同時有時算 closes", () => {
    expect(linkOf("Closes #7", 7)).toBe("closes");
    expect(linkOf("fixed: #7", 7)).toBe("closes");
    expect(linkOf("Refs #7", 7)).toBe("refs");
    expect(linkOf("Closes #7\nRefs #7", 7)).toBe("closes");
    expect(linkOf("Refs #7\nResolves #7", 7)).toBe("closes");
    expect(linkOf("Closes #70、#7", 7)).toBeNull();
    expect(linkOf(null, 7)).toBeNull();
  });
});
