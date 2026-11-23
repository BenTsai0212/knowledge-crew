// 少看的決定的讀取範圍（#49）：看得到同一員工 × 同一工作類型的交辦，才看得到這筆決定（crew/0003）。
// 虛構資料中 Rowan × support 的交辦在客服信箱（青翼專案，staff 看得到）；測試另交辦 Rowan × knowledge 到公司知識庫
// （長堤專案，staff 看不到）並加上決定，確認同一員工不同工作類型的決定 staff 看不到。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createAssignment, createLevelDecision, getTrustInputs } from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { openDatabase, type Database } from "../../src/db/database";

let db: Database;
let rowanKnowledge: string;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  await createAssignment(db, "manager", { sourceId: "company-kb", title: "FAQ entry", workTypeId: "knowledge", employeeId: "rowan" });
  rowanKnowledge = (await createLevelDecision(db, "manager", { employeeId: "rowan", workTypeId: "knowledge", decision: "relax" })).id;
});
afterAll(async () => {
  await db.close();
});

const decisionIds = (identity: string | null) =>
  db.withIdentity(identity, async (tx) =>
    (await tx.query<{ id: string }>("SELECT id FROM crew.level_decisions ORDER BY id")).rows.map((r) => r.id),
  );

describe("少看的決定：同一員工 × 同一工作類型才看得到", () => {
  it("manager 看得到既有的 d01～d04 與 Rowan × knowledge 的新決定", async () => {
    expect(await decisionIds("manager")).toEqual(["d01", "d02", "d03", "d04", rowanKnowledge].sort());
    expect((await getTrustInputs(db, "manager", "rowan", "knowledge")).decisions).toHaveLength(1);
  });

  it("staff 讀不到 Rowan × knowledge 與 Linden × knowledge（d02）的決定，只看得到 d01", async () => {
    expect(await decisionIds("staff")).toEqual(["d01"]);
    expect((await getTrustInputs(db, "staff", "rowan", "knowledge")).decisions).toEqual([]);
    expect((await getTrustInputs(db, "staff", "linden", "knowledge")).decisions).toEqual([]);
  });

  it("反例：staff 看得到 Rowan × support 的交辦，仍看不到 Rowan × knowledge 的決定", async () => {
    const visible = await db.withIdentity("staff", async (tx) => ({
      rowanSupport: (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM crew.assignments WHERE employee_id = 'rowan' AND work_type_id = 'support'",
      )).rows[0].n,
      rowanKnowledgeDecisions: (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM crew.level_decisions WHERE employee_id = 'rowan' AND work_type_id = 'knowledge'",
      )).rows[0].n,
    }));
    expect(visible.rowanSupport).toBeGreaterThan(0);
    expect(visible.rowanKnowledgeDecisions).toBe(0);
  });

  it("Rowan × support 的既有決定 staff 仍讀得到", async () => {
    const inputs = await getTrustInputs(db, "staff", "rowan", "support");
    expect(inputs.decisions).toHaveLength(1);
    expect(inputs.decisions[0].decision).toBe("relax");
  });

  it.each([["guest"], [null]])("%s：讀不到任何決定", async (identity) => {
    expect(await decisionIds(identity)).toEqual([]);
    expect((await getTrustInputs(db, identity, "rowan", "knowledge")).decisions).toEqual([]);
    expect((await getTrustInputs(db, identity, "rowan", "support")).decisions).toEqual([]);
  });

  it("pg_policies：SELECT policy 只有一條 can_see，條件含 work_type_id", async () => {
    // PERMISSIVE policy 以 OR 合併：日後另加較寬的 SELECT policy 會讓收緊失效
    const result = await db.withIdentity("manager", (tx) =>
      tx.query<{ policyname: string; qual: string }>(
        "SELECT policyname, qual FROM pg_policies WHERE schemaname = 'crew' AND tablename = 'level_decisions' AND cmd IN ('SELECT', 'ALL')",
      ),
    );
    expect(result.rows.map((r) => r.policyname)).toEqual(["can_see"]);
    expect(result.rows[0].qual).toContain("work_type_id");
    expect(result.rows[0].qual).toContain("employee_id");
  });
});
