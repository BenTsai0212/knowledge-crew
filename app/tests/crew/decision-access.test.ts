// 少看的決定的讀取範圍（#49）：看得到同一員工 × 同一工作類型的交辦，才看得到這筆決定（crew/0003）。
// 虛構資料中 Basil × docs 的交辦只在 harbor-docs（staff 看不到），Basil × test 在 lantern-notes（staff 看得到）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createLevelDecision, getTrustInputs } from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { openDatabase, type Database } from "../../src/db/database";

let db: Database;
let basilDocs: string;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  basilDocs = (await createLevelDecision(db, "manager", { employeeId: "basil", workTypeId: "docs", decision: "relax" })).id;
});
afterAll(async () => {
  await db.close();
});

const decisionIds = (identity: string | null) =>
  db.withIdentity(identity, async (tx) =>
    (await tx.query<{ id: string }>("SELECT id FROM crew.level_decisions ORDER BY id")).rows.map((r) => r.id),
  );

describe("少看的決定：同一員工 × 同一工作類型才看得到", () => {
  it("manager 看得到既有的 d01 與 Basil × docs 的新決定", async () => {
    expect(await decisionIds("manager")).toEqual(["d01", basilDocs].sort());
    expect((await getTrustInputs(db, "manager", "basil", "docs")).decisions).toHaveLength(1);
  });

  it("staff 讀不到 Basil × docs 的決定，只看得到 d01", async () => {
    expect(await decisionIds("staff")).toEqual(["d01"]);
    expect((await getTrustInputs(db, "staff", "basil", "docs")).decisions).toEqual([]);
  });

  it("反例：staff 看得到 Basil × test 的交辦，仍看不到 Basil × docs 的決定", async () => {
    const visible = await db.withIdentity("staff", async (tx) => ({
      basilTest: (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM crew.assignments WHERE employee_id = 'basil' AND work_type_id = 'test'",
      )).rows[0].n,
      basilDocsDecisions: (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM crew.level_decisions WHERE employee_id = 'basil' AND work_type_id = 'docs'",
      )).rows[0].n,
    }));
    expect(visible.basilTest).toBeGreaterThan(0);
    expect(visible.basilDocsDecisions).toBe(0);
  });

  it("Juniper × ui 的既有決定 staff 仍讀得到", async () => {
    const inputs = await getTrustInputs(db, "staff", "juniper", "ui");
    expect(inputs.decisions).toHaveLength(1);
    expect(inputs.decisions[0].decision).toBe("relax");
  });

  it.each([["guest"], [null]])("%s：讀不到任何決定", async (identity) => {
    expect(await decisionIds(identity)).toEqual([]);
    expect((await getTrustInputs(db, identity, "basil", "docs")).decisions).toEqual([]);
    expect((await getTrustInputs(db, identity, "juniper", "ui")).decisions).toEqual([]);
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
