// store.ts 的讀寫（#29 計畫第 1、5 節）：匯入 demo.json 後經 withIdentity() 讀寫，RLS 照常套用。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, recentDots, relaxSuggestion, reviewLevel } from "../trust/rules";
import { crewMigrations } from "./migrate";
import {
  createAssignment,
  createLevelDecision,
  createReview,
  createWork,
  decideGuideline,
  getAssignmentWorks,
  GuidelineError,
  listGuidelines,
  listWorkGuidelines,
  proposeGuideline,
  getTrustInputs,
  listAssignments,
  listEmployees,
  listSources,
  listReviews,
  nextExternalRef,
  type NewWork,
} from "./store";

const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });

const trust = async (db: Database, identity: string, employee: string, workType: string) => {
  const { reviews, decisions } = await getTrustInputs(db, identity, employee, workType);
  return {
    level: reviewLevel(reviews, decisions),
    suggestion: relaxSuggestion(reviews, decisions, DEMO_PARAMS),
    resets: autoResets(reviews, decisions),
    dots: recentDots(reviews, DEMO_PARAMS.dots),
    reviews,
  };
};

describe("讀取（匯入 demo.json 後）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("來源與員工依 RLS：staff 只看到青翼專案的兩個來源，guest 看不到", async () => {
    expect((await listSources(db, "manager")).map((r) => r.id).sort()).toEqual(["company-kb", "company-site", "social-account", "support-inbox"]);
    expect(await listSources(db, "staff")).toEqual([
      { id: "social-account", kind: "social", name: "Social account", projectId: "bluewing" },
      { id: "support-inbox", kind: "mailbox", name: "Support inbox", projectId: "bluewing" },
    ]);
    expect(await listSources(db, "guest")).toEqual([]);
    expect((await listEmployees(db, "staff")).map((e) => e.id)).toEqual(["juniper", "linden", "rowan", "sorrel"]);
    expect(await listEmployees(db, null)).toEqual([]);
  });

  it("listAssignments：新到舊，含最新輪次與結果；等待驗收的 latestVerdict 為 null", async () => {
    const list = await listAssignments(db, "manager");
    // #134 加了 s15、s16、c12、k14、k15、j11
    expect(list).toHaveLength(54);
    const times = list.map((a) => Date.parse(a.assignedAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));
    expect(byId.s12).toMatchObject({ sourceName: "Support inbox", externalRef: "1052", latestRound: 2, latestVerdict: "accepted", assignedBy: "manager" });
    expect(byId.s12.assignedAt).toBe(new Date("2026-10-15T09:00:00+08:00").toISOString());
    expect(byId.j02).toMatchObject({ sourceName: "example-org/company-site", externalRef: "22", latestRound: 2, latestVerdict: "accepted" });
    expect(byId.c01).toMatchObject({ sourceName: "Social account", externalRef: null });
    for (const id of ["s14", "c11", "k13", "j06", "c12", "j11"]) expect(byId[id]).toMatchObject({ latestRound: 1, latestVerdict: null });
    // #134 加了青翼專案的 s15、s16、c12
    expect((await listAssignments(db, "staff")).length).toBe(28);
    expect(await listAssignments(db, "guest")).toEqual([]);
  });

  it("getAssignmentWorks：重點、變更、檢查（同名多筆時取最新）與驗收", async () => {
    const works = await getAssignmentWorks(db, "manager", "s12");
    expect(works.map((w) => w.round)).toEqual([1, 2]);
    const [first, second] = works;
    expect(first).toMatchObject({ id: "s12-w1", externalRef: null, checks: [{ name: "banned-words", status: "pass" }, { name: "tone", status: "pass" }] });
    expect(first.points.length).toBeGreaterThan(0);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(first.review).toMatchObject({ id: "s12-1", workId: "s12-w1", verdict: "returned", reason: "wrong", decidedBy: "manager" });
    expect(second.review).toMatchObject({ id: "s12-2", verdict: "accepted", reason: null });
    expect((await getAssignmentWorks(db, "manager", "j02"))[0]).toMatchObject({ id: "j02-w1", externalRef: "32", checks: [{ name: "ci", status: "pass" }] });
    expect((await getAssignmentWorks(db, "manager", "s14"))[0].review).toBeNull();
    expect(await getAssignmentWorks(db, "staff", "k01")).toEqual([]);
  });

  it("listReviews：依時間排序，可只取某交辦", async () => {
    const all = await listReviews(db, "manager");
    // #134 加了 s16-1、k15-1
    expect(all).toHaveLength(54);
    const times = all.map((r) => Date.parse(r.decidedAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect((await listReviews(db, "manager", { assignmentId: "k07" })).map((r) => [r.id, r.reason])).toEqual([
      ["k07-1", "different_approach"],
      ["k07-2", null],
    ]);
    expect(await listReviews(db, "staff", { assignmentId: "k07" })).toEqual([]);
  });

  // #134 加了 k15-1（不一樣的做法），neutral 從 1 個變 2 個
  it("Linden × knowledge：light、沒有自動改回、最近 10 次有 2 個 neutral 沒有 wrong；staff 看不到（長堤專案）", async () => {
    const t = await trust(db, "manager", "linden", "knowledge");
    // #134 加了 k15-1
    expect(t.reviews).toHaveLength(15);
    expect(t.level).toBe("light");
    expect(t.resets).toEqual([]);
    expect(t.dots).toHaveLength(10);
    expect(t.dots.filter((d) => d === "neutral")).toHaveLength(2);
    expect(t.dots).not.toContain("wrong");
    expect(await getTrustInputs(db, "staff", "linden", "knowledge")).toEqual({ reviews: [], decisions: [] });
  });

  it("Rowan × support：看重點期間做錯了改回 item，autoResets 一筆（manager 與 staff 相同）", async () => {
    for (const identity of ["manager", "staff"]) {
      const t = await trust(db, identity, "rowan", "support");
      // #134 加了 s16-1
      expect(t.reviews).toHaveLength(16);
      expect(t.level).toBe("item");
      expect(t.resets.map((r) => r.review.id)).toEqual(["s12-1"]);
      expect(t.dots).toHaveLength(10);
      expect(t.dots.filter((d) => d === "wrong")).toHaveLength(1);
      expect(t.suggestion).toBeNull();
    }
  });

  it("Sorrel × content：item，有建議改看重點，依據是最近 10 次（不含 c01）", async () => {
    const t = await trust(db, "manager", "sorrel", "content");
    expect(t.reviews).toHaveLength(12);
    expect(t.level).toBe("item");
    expect(t.suggestion).not.toBeNull();
    expect(t.suggestion!.basis.map((r) => r.id)).toEqual(t.reviews.slice(-10).map((r) => r.id));
    expect(t.suggestion!.basis.map((r) => r.id)).not.toContain("c01-1");
    expect(t.suggestion!.basis.map((r) => r.id)).not.toContain("c01-2");
  });

  it("Juniper × dev：同意改看重點後又收回，item；收回之後還沒有驗收，沒有建議", async () => {
    const t = await trust(db, "manager", "juniper", "dev");
    expect(t.reviews).toHaveLength(11);
    expect((await getTrustInputs(db, "manager", "juniper", "dev")).decisions.map((d) => d.decision)).toEqual(["relax", "revoke"]);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
  });

  it("guest 與沒有身分讀不到信任的輸入", async () => {
    for (const identity of ["guest", null]) {
      expect(await getTrustInputs(db, identity, "rowan", "support")).toEqual({ reviews: [], decisions: [] });
    }
  });
});

const WORK: Omit<NewWork, "assignmentId"> = {
  externalRef: "999",
  summary: "Draft",
  body: "Body",
  points: ["Layout", "Colors"],
  changes: [{ path: "src/a.tsx", summary: "Changed" }],
  checks: [{ name: "ci", status: "pending" }, { name: "lint", status: "fail" }, { name: "ci", status: "pass" }],
};

describe("寫入", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("manager：交辦、交件、驗收、看重點的決定，寫入後讀回一致；身分與時間由資料庫填入", async () => {
    const before = Date.now();
    const a = await createAssignment(db, "manager", { sourceId: "company-site", title: "New card", workTypeId: "dev", employeeId: "juniper" });
    // #134 加了 j11（Issue 31）
    expect(a.externalRef).toBe("32");
    const summary = (await listAssignments(db, "manager")).find((x) => x.id === a.id)!;
    expect(summary).toMatchObject({ title: "New card", assignedBy: "manager", latestRound: null, latestVerdict: null });
    expect(Date.parse(summary.assignedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect((await listAssignments(db, "manager"))[0].id).toBe(a.id);

    const w1 = await createWork(db, "manager", { ...WORK, assignmentId: a.id });
    expect(w1.round).toBe(1);
    const r1 = await createReview(db, "manager", { workId: w1.id, verdict: "returned", reason: "process", note: "Split it" });
    const w2 = await createWork(db, "manager", { ...WORK, externalRef: "1000", assignmentId: a.id });
    expect(w2.round).toBe(2);

    const works = await getAssignmentWorks(db, "manager", a.id);
    expect(works).toHaveLength(2);
    expect(works[0]).toMatchObject({
      id: w1.id, externalRef: "999", summary: "Draft", body: "Body", points: ["Layout", "Colors"], changes: WORK.changes,
      checks: [{ name: "ci", status: "pass" }, { name: "lint", status: "fail" }],
      review: { id: r1.id, verdict: "returned", reason: "process", note: "Split it", decidedBy: "manager" },
    });
    expect(works[1].review).toBeNull();
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({ latestRound: 2, latestVerdict: null });

    const d = await createLevelDecision(db, "manager", { employeeId: "juniper", workTypeId: "dev", decision: "revoke", basisReviewId: r1.id });
    expect(d.id).toBeTruthy();
    const t = await trust(db, "manager", "juniper", "dev");
    expect(t.level).toBe("item");
    expect(t.reviews.at(-1)).toMatchObject({ id: r1.id, verdict: "returned", reason: "process" });
  });

  it.each([["staff"], ["guest"], [null]])("%s：寫入被拒，沒有留下資料", async (identity) => {
    const before = await listAssignments(db, "manager");
    const reviews = await listReviews(db, "manager");
    const decisions = (await getTrustInputs(db, "manager", "rowan", "support")).decisions;
    await expect(createAssignment(db, identity, { sourceId: "support-inbox", title: "X", workTypeId: "support", employeeId: "rowan" })).rejects.toThrow();
    await expect(createWork(db, identity, { ...WORK, assignmentId: "s14" })).rejects.toThrow();
    await expect(createReview(db, identity, { workId: "s14-w1", verdict: "accepted" })).rejects.toThrow();
    await expect(createLevelDecision(db, identity, { employeeId: "rowan", workTypeId: "support", decision: "revoke" })).rejects.toThrow();
    expect(await listAssignments(db, "manager")).toEqual(before);
    expect(await listReviews(db, "manager")).toEqual(reviews);
    expect((await getTrustInputs(db, "manager", "rowan", "support")).decisions).toEqual(decisions);
    expect(await getAssignmentWorks(db, "manager", "s14")).toHaveLength(1);
  });
});

describe("外部編號（#57）", () => {
  let db: Database;
  beforeAll(async () => {
    // demo.json 的來源之外，另加一個青翼專案的信箱（虛構、沒有 label）
    const seed = demoSeed(DEMO_RAW, clientConfig);
    db = await openDatabase(clientConfig, {
      migrations: crewMigrations,
      seed: async (pg) => {
        await seed(pg);
        await pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('inbox', 'mailbox', 'Returns inbox', 'bluewing')");
      },
    });
  });
  afterAll(() => db.close());

  it("來源有類型、依名稱排序；看得到的範圍照舊由專案決定", async () => {
    expect((await listSources(db, "manager")).map((s) => [s.id, s.kind])).toEqual([
      ["company-kb", "knowledge_base"], ["inbox", "mailbox"], ["social-account", "social"], ["support-inbox", "mailbox"], ["company-site", "repo"],
    ]);
    expect((await listSources(db, "staff")).map((s) => s.id)).toEqual(["inbox", "social-account", "support-inbox"]);
    expect(await listSources(db, "guest")).toEqual([]);
  });

  it("repo 類：交辦產生下一個 Issue 編號、交件產生下一個 PR 編號", async () => {
    // #134 加了 j11 的 PR 43
    expect(await nextExternalRef(db, "manager", "company-site")).toBe("44");
    // 看不到的來源沒有編號
    expect(await nextExternalRef(db, "staff", "company-site")).toBeNull();
  });

  it("repo 以外的類型：交辦與交件的外部編號是 null，讀回也是 null", async () => {
    const a = await createAssignment(db, "manager", { sourceId: "inbox", title: "Reply", workTypeId: "support", employeeId: "rowan" });
    expect(a.externalRef).toBeNull();
    const externalRef = await nextExternalRef(db, "manager", "inbox");
    expect(externalRef).toBeNull();
    await createWork(db, "manager", { ...WORK, externalRef, assignmentId: a.id });
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({
      sourceKind: "mailbox", sourceName: "Returns inbox", externalRef: null, latestRound: 1,
    });
    expect((await getAssignmentWorks(db, "manager", a.id))[0].externalRef).toBeNull();
    // 第二筆同樣沒有編號（NULL 不互相衝突）
    expect((await createAssignment(db, "manager", { sourceId: "inbox", title: "Reply 2", workTypeId: "support", employeeId: "rowan" })).externalRef).toBeNull();
  });
});

describe("到期日與優先順序（#133）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("匯入 demo.json：交辦帶到期日與優先順序，沒填的是 null 與 normal", async () => {
    const byId = Object.fromEntries((await listAssignments(db, "manager")).map((a) => [a.id, a]));
    expect(byId.s14).toMatchObject({ dueAt: "2026-11-18", priority: "high" });
    expect(byId.c11).toMatchObject({ dueAt: "2026-11-22", priority: "normal" });
    expect(byId.k13).toMatchObject({ dueAt: "2026-12-04", priority: "low" });
    expect(byId.j06).toMatchObject({ dueAt: null, priority: "high" });
    expect(byId.s01).toMatchObject({ dueAt: null, priority: "normal" });
  });

  it("RLS 不變：staff 只看到青翼專案的交辦與其到期日", async () => {
    const staff = await listAssignments(db, "staff");
    expect(staff.find((a) => a.id === "s14")).toMatchObject({ dueAt: "2026-11-18", priority: "high" });
    expect(staff.find((a) => a.id === "k13")).toBeUndefined();
    expect(staff.find((a) => a.id === "j06")).toBeUndefined();
  });

  it("manager：交辦時可以填到期日與優先順序；沒填時是 null 與 normal", async () => {
    const a = await createAssignment(db, "manager", {
      sourceId: "company-site", title: "Due card", workTypeId: "dev", employeeId: "juniper", dueAt: "2026-12-01", priority: "low",
    });
    const b = await createAssignment(db, "manager", { sourceId: "company-site", title: "Plain card", workTypeId: "dev", employeeId: "juniper" });
    const list = await listAssignments(db, "manager");
    expect(list.find((x) => x.id === a.id)).toMatchObject({ dueAt: "2026-12-01", priority: "low" });
    expect(list.find((x) => x.id === b.id)).toMatchObject({ dueAt: null, priority: "normal" });
  });

  it("kk_app 只有 INSERT：不能改到期日與優先順序；不合法的優先順序被拒", async () => {
    await expect(db.withIdentity("manager", (tx) => tx.query("UPDATE crew.assignments SET priority = 'high' WHERE id = 's01'"))).rejects.toThrow(/permission denied/);
    await expect(db.withIdentity("manager", (tx) => tx.query("UPDATE crew.assignments SET due_at = '2026-01-01' WHERE id = 's01'"))).rejects.toThrow(/permission denied/);
    await expect(
      createAssignment(db, "manager", { sourceId: "company-site", title: "Bad", workTypeId: "dev", employeeId: "juniper", priority: "urgent" as "high" }),
    ).rejects.toThrow(/check constraint/);
    expect((await listAssignments(db, "manager")).find((x) => x.id === "s01")).toMatchObject({ dueAt: null, priority: "normal" });
  });

  it.each([["staff"], ["guest"], [null]])("%s：帶到期日的交辦同樣被拒", async (identity) => {
    const before = await listAssignments(db, "manager");
    await expect(
      createAssignment(db, identity, { sourceId: "support-inbox", title: "X", workTypeId: "support", employeeId: "rowan", dueAt: "2026-12-01", priority: "high" }),
    ).rejects.toThrow();
    expect(await listAssignments(db, "manager")).toEqual(before);
  });
});

describe("守則（#142）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  const guideline = async (id: string) => (await listGuidelines(db, "manager")).find((g) => g.id === id)!;

  it("createReview() 的 saveAsGuideline：同一交易寫入人提的守則與一筆確認，立即生效", async () => {
    const r = await createReview(db, "manager", { workId: "s14-w1", verdict: "returned", reason: "wrong", note: "Ask for the last four digits first", saveAsGuideline: true });
    expect(r.guidelineId).toBeTruthy();
    const g = await guideline(r.guidelineId!);
    expect(g).toMatchObject({
      employeeId: "rowan", workTypeId: "support", text: "Ask for the last four digits first", currentText: "Ask for the last four digits first",
      status: "active", proposerKind: "human", proposedBy: "manager",
      sourceReviewId: r.id, sourceWorkId: "s14-w1", sourceAssignmentId: "s14",
      sourceReview: { id: r.id, verdict: "returned", reason: "wrong", note: "Ask for the last four digits first" },
    });
    expect(g.decisions).toMatchObject([{ decision: "confirm", revisedText: null, decidedBy: "manager" }]);
    expect(g.decisions[0].decidedAt).toBe(g.proposedAt);
    expect(g.proposedAt).toBe(g.sourceReview!.decidedAt);
    // 不勾選時不寫守則
    const plain = await createReview(db, "manager", { workId: "c11-w1", verdict: "returned", reason: "wrong", note: "Check the price" });
    expect(plain.guidelineId).toBeNull();
    expect((await listGuidelines(db, "manager")).map((x) => x.sourceReviewId)).not.toContain(plain.id);
  });

  it.each([
    ["流程上的小問題", { reason: "process" as const, note: "Resize the image" }],
    ["意見是空的", { reason: "wrong" as const, note: " " }],
    ["沒有意見", { reason: "different_approach" as const }],
  ])("saveAsGuideline 但%s：拋出 not-eligible，驗收也沒有寫入", async (_name, review) => {
    const before = await listGuidelines(db, "manager");
    const error = await createReview(db, "manager", { workId: "j06-w1", verdict: "returned", saveAsGuideline: true, ...review }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GuidelineError);
    expect(error).toMatchObject({ code: "not-eligible" });
    expect((await getAssignmentWorks(db, "manager", "j06"))[0].review).toBeNull();
    expect(await listGuidelines(db, "manager")).toEqual(before);
  });

  it("員工提出 → 修改後確認（以修改後的文字為準）→ 收回；已收回不能再確認", async () => {
    const source = (await listReviews(db, "manager", { assignmentId: "c11" }))[0];
    const { id } = await proposeGuideline(db, "manager", { sourceReviewId: source.id, text: "Match the campaign page" });
    expect(await guideline(id)).toMatchObject({ status: "pending", proposerKind: "employee", proposedBy: null, employeeId: "sorrel", workTypeId: "content", decisions: [] });

    await expect(decideGuideline(db, "manager", { guidelineId: id, decision: "revoke" })).rejects.toMatchObject({ code: "invalid-transition" });
    await decideGuideline(db, "manager", { guidelineId: id, decision: "confirm", revisedText: "Match the campaign page word for word" });
    expect(await guideline(id)).toMatchObject({ status: "active", text: "Match the campaign page", currentText: "Match the campaign page word for word" });

    await decideGuideline(db, "manager", { guidelineId: id, decision: "revoke" });
    const revoked = await guideline(id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.decisions.map((d) => d.decision)).toEqual(["confirm", "revoke"]);
    for (const decision of ["confirm", "reject", "revoke"] as const) {
      await expect(decideGuideline(db, "manager", { guidelineId: id, decision })).rejects.toMatchObject({ code: "invalid-transition" });
    }
    expect((await guideline(id)).decisions).toHaveLength(2);
  });

  it("不採用之後不能再確認；看不到或不能成為守則的來源被拒", async () => {
    const source = (await listReviews(db, "manager", { assignmentId: "c11" }))[0];
    const { id } = await proposeGuideline(db, "manager", { sourceReviewId: source.id, text: "Always use a table" });
    await decideGuideline(db, "manager", { guidelineId: id, decision: "reject" });
    expect((await guideline(id)).status).toBe("rejected");
    await expect(decideGuideline(db, "manager", { guidelineId: id, decision: "confirm" })).rejects.toMatchObject({ code: "invalid-transition" });
    await expect(decideGuideline(db, "manager", { guidelineId: "nowhere", decision: "confirm" })).rejects.toMatchObject({ code: "not-found" });
    // c05-1 是流程上的小問題；k01-1 在長堤專案，staff 看不到
    await expect(proposeGuideline(db, "manager", { sourceReviewId: "c05-1", text: "X" })).rejects.toMatchObject({ code: "not-eligible" });
    await expect(proposeGuideline(db, "staff", { sourceReviewId: "k01-1", text: "X" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("交件依照生效的守則；listGuidelines 可依員工與工作類型篩選", async () => {
    // demo.json 的 g01（#142 PR 2）之外，這個檔案前面的測試以 saveAsGuideline 新增的一條
    const active = (await listGuidelines(db, "manager", { employeeId: "rowan", workTypeId: "support" })).filter((g) => g.status === "active" && g.id !== "g01");
    expect(active).toHaveLength(1);
    const w = await createWork(db, "manager", { ...WORK, externalRef: null, assignmentId: "s15", guidelineIds: [active[0].id] });
    expect((await listWorkGuidelines(db, "manager", w.id)).map((g) => g.id)).toEqual([active[0].id]);
    // s14-w1 依照 demo.json 的 g01（#142 PR 2）；來源交辦的第 2 輪 s05-w2 沒有依照守則
    expect((await listWorkGuidelines(db, "manager", "s14-w1")).map((g) => g.id)).toEqual(["g01"]);
    expect(await listWorkGuidelines(db, "manager", "s05-w2")).toEqual([]);
    expect((await listGuidelines(db, "manager", { workTypeId: "content" })).every((g) => g.employeeId === "sorrel")).toBe(true);
    expect(await listGuidelines(db, "guest")).toEqual([]);
  });
});
