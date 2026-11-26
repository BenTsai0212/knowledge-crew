// 看重點的建議的依據與經過（#125）：relaxProposals() 的推算、suggestionBasis() 與 suggestionHistory() 的整理，
// 以純函式的小例子，以及匯入虛構資料（demo.json）後的工作帳本比對。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createLevelDecision, getTrustInputs } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { DEMO_PARAMS } from "../trust/demo-params";
import { relaxSuggestion } from "../trust/rules";
import type { LevelDecision, Review } from "../trust/types";
import { readLedger, type LedgerEvent } from "./ledger";
import { relaxProposals, suggestionBasis, suggestionHistory } from "./suggestion-history";

const lang = clientConfig.client.defaultLanguage;
const P = { window: 3, min: 3 };
const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();
const ok = (n: number, hour?: number): Review => ({ id: `r${n}`, verdict: "accepted", reason: null, decidedAt: day(n, hour) });
const wrong = (n: number): Review => ({ id: `r${n}`, verdict: "returned", reason: "wrong", decidedAt: day(n) });
const neutral = (n: number): Review => ({ id: `r${n}`, verdict: "returned", reason: "process", decidedAt: day(n) });
const relax = (n: number, hour = 12): LevelDecision => ({ decision: "relax", decidedAt: day(n, hour) });
const revoke = (n: number, hour = 12): LevelDecision => ({ decision: "revoke", decidedAt: day(n, hour) });
const ids = (reviews: readonly Review[]) => reviews.map((r) => r.id);

describe("relaxProposals：提出看重點的建議的時間與依據", () => {
  it("沒有決定時：第一次符合條件的那次驗收；之後不再重複提出", () => {
    const proposals = relaxProposals([ok(1), ok(2), ok(3), ok(4), ok(5)], [], P);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ at: day(3), review: { id: "r3" } });
    expect(ids(proposals[0].basis)).toEqual(["r1", "r2", "r3"]);
  });

  it("其他退回不影響；做錯了要等它離開最近 window 次", () => {
    expect(ids(relaxProposals([ok(1), neutral(2), ok(3)], [], P)[0].basis)).toEqual(["r1", "r2", "r3"]);
    const proposals = relaxProposals([wrong(1), ok(2), ok(3), ok(4), ok(5)], [], P);
    expect(proposals.map((p) => p.review.id)).toEqual(["r4"]);
    expect(ids(proposals[0].basis)).toEqual(["r2", "r3", "r4"]);
  });

  it("不足 min 次、或沒有驗收時沒有", () => {
    expect(relaxProposals([ok(1), ok(2)], [], P)).toEqual([]);
    expect(relaxProposals([], [relax(1)], P)).toEqual([]);
  });

  it("同意、收回後重新累積才再提出：每筆決定之後各算一段", () => {
    const reviews = [ok(1), ok(2), ok(3), ok(5), ok(7), ok(8), ok(9)];
    const proposals = relaxProposals(reviews, [relax(4), revoke(6)], P);
    // 看重點期間（r5）不提出；收回後 r7、r8、r9 累積到 3 次才再提出
    expect(proposals.map((p) => p.review.id)).toEqual(["r3", "r9"]);
    expect(ids(proposals[1].basis)).toEqual(["r7", "r8", "r9"]);
  });

  it("看重點期間做錯了改回逐項看：同一段的驗收（含那次做錯了）離開最近 window 次後才提出", () => {
    const reviews = [ok(1), ok(2), ok(3), wrong(5), ok(6), ok(7), ok(8), ok(9)];
    const proposals = relaxProposals(reviews, [relax(4)], P);
    expect(proposals.map((p) => p.review.id)).toEqual(["r3", "r8"]);
  });

  it("與決定同時的驗收算在決定之後（rules.ts：同時間決定在先）", () => {
    // revoke 與 r4 同時：r4 不算在 revoke 之後的累積；收回後要 r5、r6、r7
    const reviews = [ok(1), ok(2), ok(3), ok(4), ok(5), ok(6), ok(7)];
    expect(relaxProposals(reviews, [relax(3, 13), revoke(4)], P).map((p) => p.review.id)).toEqual(["r3", "r7"]);
  });

  it("最新一段的提出與 relaxSuggestion() 的建議一致（同一套規則）", () => {
    const reviews = [ok(1), ok(2), ok(3), ok(5), ok(7), ok(8), ok(9)];
    const decisions = [relax(4), revoke(6)];
    const last = relaxProposals(reviews, decisions, P).at(-1)!;
    expect(ids(last.basis)).toEqual(ids(relaxSuggestion(reviews, decisions, P)!.basis));
  });
});

const ev = (id: string, kind: LedgerEvent["kind"], at: string, extra: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id,
  kind,
  at,
  employee: { id: "basil", displayName: "Basil" },
  workTypeId: "docs",
  assignment: null,
  actor: null,
  round: null,
  reason: null,
  ...extra,
});
const work = (id: string) => ({ id, title: id.toUpperCase(), sourceKind: "repo" as const, sourceName: "example-org/r", externalRef: null });

describe("suggestionBasis 與 suggestionHistory（帳本事件，新到舊）", () => {
  // 新到舊：r1、r2 通過 → 提出 → 同意 → r3（生效）→ r4 做錯了 → 改回 → 同意 → 收回
  const events: LedgerEvent[] = [
    ev("revoke:d3", "revoke", day(9), { actor: "manager" }),
    ev("relax:d2", "relax", day(8), { actor: "manager" }),
    ev("autoReset:r4", "autoReset", day(7), { assignment: work("a4") }),
    ev("returned:r4", "returned", day(7), { assignment: work("a4"), reason: "wrong" }),
    ev("accepted:r3", "accepted", day(5), { assignment: work("a3") }),
    ev("relax:d1", "relax", day(4), { actor: "manager" }),
    ev("proposed:r2", "proposed", day(2), { assignment: work("a2"), basis: ["r1", "r2"] }),
    ev("accepted:r2", "accepted", day(2), { assignment: work("a2") }),
    ev("accepted:r1", "accepted", day(1), { assignment: work("a1") }),
    ev("assigned:x", "assigned", day(1), { employee: { id: "rowan", displayName: "Rowan" } }),
  ];

  it("依據：驗收 id 對到帳本的時間與工作，順序不變；帳本沒有的略過", () => {
    expect(suggestionBasis(["r1", "r2", "hidden"], events)).toEqual([
      { reviewId: "r1", at: day(1), assignment: work("a1") },
      { reviewId: "r2", at: day(2), assignment: work("a2") },
    ]);
    expect(suggestionBasis([], events)).toEqual([]);
  });

  it("經過：提出 → 同意 → 生效 → 改回逐項看 → 同意 → 收回（同意後沒有驗收就收回時沒有生效）", () => {
    expect(suggestionHistory(events, "basil", "docs")).toEqual([
      { kind: "proposed", at: day(2), basis: suggestionBasis(["r1", "r2"], events) },
      { kind: "relax", at: day(4), actor: "manager" },
      { kind: "effective", at: day(5), assignment: work("a3") },
      { kind: "autoReset", at: day(7), assignment: work("a4") },
      { kind: "relax", at: day(8), actor: "manager" },
      { kind: "revoke", at: day(9), actor: "manager" },
    ]);
  });

  it("其他員工 × 工作類型的事件不算；沒有任何經過時是空陣列", () => {
    expect(suggestionHistory(events, "rowan", "docs")).toEqual([]);
    expect(suggestionHistory(events.slice(-2), "basil", "docs")).toEqual([]);
  });

  it("做錯了的那次就是生效的那次：生效在改回之前", () => {
    const sameTime = [ev("autoReset:r4", "autoReset", day(7)), ev("returned:r4", "returned", day(7), { reason: "wrong" }), ev("relax:d1", "relax", day(4))];
    expect(suggestionHistory(sameTime, "basil", "docs").map((s) => s.kind)).toEqual(["relax", "effective", "autoReset"]);
  });
});

describe("匯入虛構資料後（demo.json）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  });
  afterAll(() => db.close());

  const proposalsOf = async (employee: string, workType: string) => {
    const { reviews, decisions, corrections } = await getTrustInputs(db, "manager", employee, workType);
    return relaxProposals(reviews, decisions, DEMO_PARAMS, corrections).map((p) => [p.review.id, ids(p.basis)]);
  };
  const kinds = (events: LedgerEvent[], employee: string, workType: string) =>
    suggestionHistory(events, employee, workType).map((s) => [s.kind, s.at.slice(0, 10)]);

  // #161：Linden 的 k01-2 在 9/04 事後更正（算一次做錯了），k09-1 的依據含 k01-2 不再成立，改由 k16-1 提出
  it("四組各提出一次：第 10 次沒有做錯的驗收（Rowan s09、Linden k16、Sorrel c09、Juniper j10）", async () => {
    expect(await proposalsOf("rowan", "support")).toEqual([
      ["s09-1", ["s01-1", "s02-1", "s03-1", "s04-1", "s05-1", "s05-2", "s06-1", "s07-1", "s08-1", "s09-1"]],
    ]);
    expect(await proposalsOf("linden", "knowledge")).toEqual([
      ["k16-1", ["k02-1", "k03-1", "k04-1", "k05-1", "k06-1", "k07-1", "k07-2", "k08-1", "k09-1", "k16-1"]],
    ]);
    expect(await proposalsOf("sorrel", "content")).toEqual([
      ["c09-1", ["c01-2", "c02-1", "c03-1", "c04-1", "c05-1", "c05-2", "c06-1", "c07-1", "c08-1", "c09-1"]],
    ]);
    expect(await proposalsOf("juniper", "dev")).toEqual([
      ["j10-1", ["j01-1", "j07-1", "j02-1", "j02-2", "j08-1", "j03-1", "j09-1", "j04-1", "j04-2", "j10-1"]],
    ]);
  });

  it("帳本的提出看重點的建議與推算一致；manager 的經過：Juniper 完整一輪、Rowan 自動改回、Linden 看重點中、Sorrel 等人決定", async () => {
    const events = await readLedger(db, "manager", lang);
    const proposed = events.filter((e) => e.kind === "proposed");
    expect(proposed.map((e) => [e.id, e.actor, e.basis?.length])).toEqual([
      ["proposed:c09-1", null, 10],
      ["proposed:j10-1", null, 10],
      ["proposed:k16-1", null, 10],
      ["proposed:s09-1", null, 10],
    ]);
    expect(kinds(events, "juniper", "dev")).toEqual([
      ["proposed", "2026-10-16"],
      ["relax", "2026-10-19"],
      ["effective", "2026-10-22"],
      ["revoke", "2026-11-10"],
    ]);
    const juniper = suggestionHistory(events, "juniper", "dev");
    expect(juniper[2]).toMatchObject({ kind: "effective", assignment: { id: "j05" } });
    expect(juniper[0]).toMatchObject({ kind: "proposed", basis: expect.arrayContaining([expect.objectContaining({ reviewId: "j10-1", assignment: expect.objectContaining({ id: "j10" }) })]) });
    expect(kinds(events, "rowan", "support")).toEqual([
      ["proposed", "2026-10-03"],
      ["relax", "2026-10-09"],
      ["effective", "2026-10-10"],
      ["autoReset", "2026-10-15"],
    ]);
    // #161：同意後的第一次驗收是 s17；做錯了的 s12 是同意後的第 5 件（抽查）
    expect(suggestionHistory(events, "rowan", "support")[2]).toMatchObject({ assignment: { id: "s17" } });
    expect(suggestionHistory(events, "rowan", "support")[3]).toMatchObject({ assignment: { id: "s12" } });
    expect(kinds(events, "linden", "knowledge")).toEqual([
      ["proposed", "2026-10-12"],
      ["relax", "2026-10-13"],
      ["effective", "2026-10-16"],
    ]);
    expect(kinds(events, "sorrel", "content")).toEqual([["proposed", "2026-10-21"]]);
  });

  it("staff：只有看得到的兩組（青翼專案）；guest 沒有", async () => {
    const events = await readLedger(db, "staff", lang);
    expect(kinds(events, "rowan", "support").map(([k]) => k)).toEqual(["proposed", "relax", "effective", "autoReset"]);
    expect(kinds(events, "sorrel", "content").map(([k]) => k)).toEqual(["proposed"]);
    expect(suggestionHistory(events, "juniper", "dev")).toEqual([]);
    expect(suggestionHistory(await readLedger(db, "guest", lang), "rowan", "support")).toEqual([]);
  });

  it("同意與收回後，經過與帳本跟著更新（Sorrel）", async () => {
    const own = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
    try {
      await createLevelDecision(own, "manager", { employeeId: "sorrel", workTypeId: "content", decision: "relax", basisReviewId: "c10-1" });
      let events = await readLedger(own, "manager", lang);
      expect(suggestionHistory(events, "sorrel", "content").map((s) => s.kind)).toEqual(["proposed", "relax"]);
      await createLevelDecision(own, "manager", { employeeId: "sorrel", workTypeId: "content", decision: "revoke" });
      events = await readLedger(own, "manager", lang);
      expect(suggestionHistory(events, "sorrel", "content").map((s) => s.kind)).toEqual(["proposed", "relax", "revoke"]);
      expect(events.filter((e) => e.employee.id === "sorrel" && (e.kind === "relax" || e.kind === "revoke")).map((e) => e.actor)).toEqual(["manager", "manager"]);
    } finally {
      await own.close();
    }
  }, 30_000);
});
