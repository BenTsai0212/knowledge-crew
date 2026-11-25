// 守則的讀取範圍與寫入權限（#142、crew ADR 0007 決定 6）。讀取與 crew.level_decisions（crew/0003）相同：看得到同一員工 ×
// 同一工作類型的交辦才看得到守則與決定；依照的守則跟著交件。寫入與寫入驗收相同：can_review、不能冒名、看得到範圍。
// 虛構資料中 Rowan × support 在客服信箱（青翼專案，staff 看得到）；測試另交辦 Rowan × knowledge 到公司知識庫（長堤專案，staff 看不到）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import {
  createAssignment, createReview, createWork, decideGuideline, listGuidelines, listWorkGuidelines, proposeGuideline, type NewWork,
} from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { openDatabase, type Database } from "../../src/db/database";

const WORK: Omit<NewWork, "assignmentId"> = { externalRef: null, summary: "Draft", body: "Body", points: [], changes: [], checks: [] };

let db: Database;
let knowledge: { assignment: string; firstWork: string; laterWork: string; guideline: string };
let support: { review: string; guideline: string; pending: string };

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  const a = await createAssignment(db, "manager", { sourceId: "company-kb", title: "FAQ entry", workTypeId: "knowledge", employeeId: "rowan" });
  const w1 = await createWork(db, "manager", { ...WORK, assignmentId: a.id });
  const r1 = await createReview(db, "manager", { workId: w1.id, verdict: "returned", reason: "wrong", note: "Cite the contract", saveAsGuideline: true });
  const w2 = await createWork(db, "manager", { ...WORK, assignmentId: a.id, guidelineIds: [r1.guidelineId!] });
  knowledge = { assignment: a.id, firstWork: w1.id, laterWork: w2.id, guideline: r1.guidelineId! };
  const rs = await createReview(db, "manager", { workId: "s14-w1", verdict: "returned", reason: "different_approach", note: "Answer first", saveAsGuideline: true });
  const pending = await proposeGuideline(db, "manager", { sourceReviewId: rs.id, text: "Answer before quoting the rules" });
  support = { review: rs.id, guideline: rs.guidelineId!, pending: pending.id };
}, 30_000);
afterAll(async () => {
  await db.close();
});

// demo.json 的守則 g01～g06（#142 PR 2）另在最後一個 describe 檢查；這裡只看測試新增的列（id 是 UUID）
const DEMO_GUIDELINE = "g0[1-6]";
const ids = (identity: string | null, sql: string) =>
  db.withIdentity(identity, async (tx) => (await tx.query<{ id: string }>(sql)).rows.map((r) => r.id).sort());
const guidelineIds = (identity: string | null) => ids(identity, `SELECT id FROM crew.guidelines WHERE id !~ '^${DEMO_GUIDELINE}$'`);
const decisionGuidelines = (identity: string | null) =>
  ids(identity, `SELECT DISTINCT guideline_id AS id FROM crew.guideline_decisions WHERE guideline_id !~ '^${DEMO_GUIDELINE}$'`);
const followedWorks = (identity: string | null) => ids(identity, `SELECT work_id AS id FROM crew.work_guidelines WHERE guideline_id !~ '^${DEMO_GUIDELINE}$'`);
const demoIds = (identity: string | null, sql: string) => ids(identity, `${sql} ~ '^${DEMO_GUIDELINE}$'`);

describe("讀取：同一員工 × 同一工作類型才看得到", () => {
  it("manager 看得到三條守則、兩條的決定與依照的守則", async () => {
    expect(await guidelineIds("manager")).toEqual([knowledge.guideline, support.guideline, support.pending].sort());
    expect(await decisionGuidelines("manager")).toEqual([knowledge.guideline, support.guideline].sort());
    expect(await followedWorks("manager")).toEqual([knowledge.laterWork]);
    expect((await listWorkGuidelines(db, "manager", knowledge.laterWork)).map((g) => g.id)).toEqual([knowledge.guideline]);
  });

  it("staff 看得到 Rowan × support，看不到 Rowan × knowledge 的守則、決定與依照的守則", async () => {
    expect(await guidelineIds("staff")).toEqual([support.guideline, support.pending].sort());
    expect(await decisionGuidelines("staff")).toEqual([support.guideline]);
    expect(await followedWorks("staff")).toEqual([]);
    expect(await listGuidelines(db, "staff", { employeeId: "rowan", workTypeId: "knowledge" })).toEqual([]);
    expect(await listWorkGuidelines(db, "staff", knowledge.laterWork)).toEqual([]);
  });

  it.each([["guest"], [null]])("%s：讀不到任何守則", async (identity) => {
    expect(await guidelineIds(identity)).toEqual([]);
    expect(await decisionGuidelines(identity)).toEqual([]);
    expect(await followedWorks(identity)).toEqual([]);
  });

  it("pg_policies：三張表的 SELECT policy 都只有一條 can_see；守則的條件含員工與工作類型", async () => {
    const result = await db.withIdentity("manager", (tx) =>
      tx.query<{ tablename: string; policyname: string; qual: string }>(
        `SELECT tablename, policyname, qual FROM pg_policies
         WHERE schemaname = 'crew' AND tablename IN ('guidelines', 'guideline_decisions', 'work_guidelines') AND cmd IN ('SELECT', 'ALL')
         ORDER BY tablename`,
      ),
    );
    expect(result.rows.map((r) => [r.tablename, r.policyname])).toEqual([
      ["guideline_decisions", "can_see"], ["guidelines", "can_see"], ["work_guidelines", "can_see"],
    ]);
    const guidelines = result.rows.find((r) => r.tablename === "guidelines")!;
    expect(guidelines.qual).toContain("employee_id");
    expect(guidelines.qual).toContain("work_type_id");
  });
});

describe("寫入：只限能驗收的身分，不能冒名", () => {
  it.each([["staff"], ["guest"], [null]])("%s：提出、決定、依照都被拒，沒有留下資料", async (identity) => {
    const before = await guidelineIds("manager");
    await expect(proposeGuideline(db, identity, { sourceReviewId: support.review, text: "X" })).rejects.toThrow();
    await expect(decideGuideline(db, identity, { guidelineId: support.pending, decision: "confirm" })).rejects.toThrow();
    await expect(
      db.withIdentity(identity, (tx) => tx.exec(`
        INSERT INTO crew.work_guidelines (work_id, guideline_id, assignment_id, employee_id, work_type_id)
        VALUES ('s15-none', '${support.guideline}', 's15', 'rowan', 'support')`)),
    ).rejects.toThrow();
    expect(await guidelineIds("manager")).toEqual(before);
    expect((await listGuidelines(db, "manager", { employeeId: "rowan", workTypeId: "support" })).find((g) => g.id === support.pending)?.status).toBe("pending");
  });

  it("manager 冒名：人提的守則寫成別人提出、決定寫成別人決定，都被拒", async () => {
    const [source] = (await listGuidelines(db, "manager")).filter((g) => g.id === support.guideline);
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.guidelines (id, employee_id, work_type_id, text, source_review_id, source_work_id, source_assignment_id, proposer_kind, proposed_by)
      VALUES ('fake', 'rowan', 'support', 'X', '${source.sourceReviewId}', '${source.sourceWorkId}', '${source.sourceAssignmentId}', 'human', 'staff')`))).rejects.toThrow(/row-level security/);
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.guideline_decisions (id, guideline_id, decision, decided_by) VALUES ('fake', '${support.pending}', 'confirm', 'staff')`))).rejects.toThrow(/row-level security/);
  });

  it("時間欄位不能指定（欄位層級的 INSERT 權限）", async () => {
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.guideline_decisions (id, guideline_id, decision, decided_at) VALUES ('t', '${support.pending}', 'confirm', '2020-01-01')`))).rejects.toThrow(/permission denied/);
  });

  it("沒有確認過不能收回：繞過存取函式直接寫入也被拒（收回要指向同一守則的確認）", async () => {
    const [confirmed] = (await listGuidelines(db, "manager")).filter((g) => g.id === support.guideline);
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.guideline_decisions (id, guideline_id, decision) VALUES ('rv', '${support.pending}', 'revoke')`))).rejects.toThrow(/check constraint/);
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.guideline_decisions (id, guideline_id, decision, confirm_id)
      VALUES ('rv', '${support.pending}', 'revoke', '${confirmed.decisions[0].id}')`))).rejects.toThrow(/foreign key/);
  });

  it("只能依照交件當時生效的守則：等確認、確認之前的交件、收回之後的交件都被拒", async () => {
    // 等確認的守則：交件連同交辦一起回滾
    await expect(createWork(db, "manager", { ...WORK, assignmentId: "s15", guidelineIds: [support.pending] })).rejects.toThrow(/row-level security/);
    expect(await listWorkGuidelines(db, "manager", "s15-w1")).toEqual([]);
    expect((await db.withIdentity("manager", (tx) => tx.query("SELECT 1 FROM crew.works WHERE assignment_id = 's15'"))).rows).toEqual([]);
    // 確認之前交的件
    await expect(db.withIdentity("manager", (tx) => tx.exec(`
      INSERT INTO crew.work_guidelines (work_id, guideline_id, assignment_id, employee_id, work_type_id)
      VALUES ('${knowledge.firstWork}', '${knowledge.guideline}', '${knowledge.assignment}', 'rowan', 'knowledge')`))).rejects.toThrow(/row-level security/);
    // 收回之後交的件；收回之前已依照的紀錄保留
    await decideGuideline(db, "manager", { guidelineId: knowledge.guideline, decision: "revoke" });
    await expect(createWork(db, "manager", { ...WORK, assignmentId: knowledge.assignment, guidelineIds: [knowledge.guideline] })).rejects.toThrow(/row-level security/);
    expect((await listWorkGuidelines(db, "manager", knowledge.laterWork)).map((g) => [g.id, g.status])).toEqual([[knowledge.guideline, "revoked"]]);
  });
});

describe("demo.json 的守則（#142 PR 2）：讀取範圍同上", () => {
  it("manager 看得到 6 條守則與全部的決定、37 次依照；staff 只看得到青翼專案的員工 × 工作類型；guest 看不到", async () => {
    const guidelines = (identity: string | null) => demoIds(identity, "SELECT id FROM crew.guidelines WHERE id");
    const decisions = (identity: string | null) => demoIds(identity, "SELECT DISTINCT guideline_id AS id FROM crew.guideline_decisions WHERE guideline_id");
    const follows = async (identity: string | null) =>
      (await demoIds(identity, "SELECT work_id || '/' || guideline_id AS id FROM crew.work_guidelines WHERE guideline_id")).length;
    expect(await guidelines("manager")).toEqual(["g01", "g02", "g03", "g04", "g05", "g06"]);
    expect(await decisions("manager")).toEqual(["g01", "g03", "g04", "g05", "g06"]);
    expect(await follows("manager")).toBe(37);
    // Rowan × support、Sorrel × content 在青翼專案；Linden、Juniper 在長堤專案
    expect(await guidelines("staff")).toEqual(["g01", "g02", "g03"]);
    expect(await guidelines("guest")).toEqual([]);
    expect(await follows("guest")).toBe(0);
  });
});
