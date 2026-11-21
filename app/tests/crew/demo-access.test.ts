// 虛構資料匯入後，各身分讀到的範圍符合 RLS（#29）：staff 只看到青翼專案的 repo（lantern-notes）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { openDatabase, type Database } from "../../src/db/database";

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(async () => {
  await db.close();
});

const read = (identity: string | null) =>
  db.withIdentity(identity, async (tx) => {
    const ids = async (sql: string) => (await tx.query<{ k: string }>(sql)).rows.map((r) => r.k);
    const count = async (table: string) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM crew.${table}`)).rows[0].n;
    return {
      sources: await ids("SELECT name AS k FROM crew.sources ORDER BY 1"),
      employees: await ids("SELECT id AS k FROM crew.employees ORDER BY 1"),
      // 員工 × 工作類型的交辦筆數
      assignments: Object.fromEntries(
        (await tx.query<{ k: string; n: number }>(
          "SELECT employee_id || '/' || work_type_id AS k, count(*)::int AS n FROM crew.assignments GROUP BY 1 ORDER BY 1",
        )).rows.map((r) => [r.k, r.n]),
      ),
      total: await count("assignments"),
      works: await count("works"),
      reviews: await count("reviews"),
      levelDecisions: await ids("SELECT id AS k FROM crew.level_decisions ORDER BY 1"),
    };
  });

describe("虛構資料的讀取範圍", () => {
  it("manager：兩個 repo、26 筆交辦", async () => {
    expect(await read("manager")).toEqual({
      sources: ["example-org/harbor-docs", "example-org/lantern-notes"],
      employees: ["basil", "juniper"],
      assignments: { "basil/docs": 11, "basil/test": 2, "juniper/ui": 13 },
      total: 26,
      works: 30,
      reviews: 28,
      levelDecisions: ["d01"],
    });
  });

  it("staff：只看到 lantern-notes 的 15 筆交辦（Juniper × ui 13、Basil × test 2）", async () => {
    expect(await read("staff")).toEqual({
      sources: ["example-org/lantern-notes"],
      employees: ["basil", "juniper"],
      assignments: { "basil/test": 2, "juniper/ui": 13 },
      total: 15,
      works: 17,
      reviews: 16,
      levelDecisions: ["d01"],
    });
  });

  it.each([["guest"], [null]])("%s：沒有任何交辦與 repo", async (identity) => {
    const result = await read(identity);
    expect(result.sources).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.works).toBe(0);
    expect(result.reviews).toBe(0);
    expect(result.levelDecisions).toEqual([]);
  });
});
