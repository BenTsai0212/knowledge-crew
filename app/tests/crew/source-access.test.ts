// repo 以外的工作來源同樣受專案權限限制（#57）。寫法同 work-access.test.ts，放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { openDatabase, type Database } from "../../src/db/database";

// 虛構資料：每個專案各一個非 repo 類的來源，交辦與工作沒有外部編號。lead 同 work-access.test.ts：有 can_review、只屬青翼
async function seed(pg: PGliteInterface): Promise<void> {
  await pg.exec(`
    INSERT INTO kk.identities (id, visibility_level_id, can_review) VALUES ('lead', 'internal', true);
    INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ('lead', 'bluewing');
    INSERT INTO crew.sources (id, kind, name, project_id) VALUES
      ('inbox', 'mailbox', 'Support inbox', 'bluewing'),
      ('wiki', 'knowledge_base', 'Harbor wiki', 'longpier'),
      ('feed', 'social', 'Harbor feed', 'longpier');
    INSERT INTO crew.employees (id, display_name) VALUES ('basil', 'Basil');
    INSERT INTO crew.work_types (id) VALUES ('docs');
    INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES
      ('a-inbox', 'inbox', NULL, 'Reply', 'docs', 'basil', 'manager'),
      ('a-wiki', 'wiki', NULL, 'Article', 'docs', 'basil', 'manager'),
      ('a-feed', 'feed', 'POST-1', 'Post', 'docs', 'basil', 'manager');
    INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES
      ('w-inbox', 'a-inbox', 1, NULL, 'Draft'), ('w-wiki', 'a-wiki', 1, NULL, 'Draft'), ('w-feed', 'a-feed', 1, NULL, 'Draft');
  `);
}

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed });
});
afterAll(async () => {
  await db.close();
});

const read = (identity: string | null) =>
  db.withIdentity(identity, async (tx) => {
    const ids = async (sql: string) => (await tx.query<{ k: string }>(sql)).rows.map((r) => r.k);
    return {
      sources: await ids("SELECT id AS k FROM crew.sources ORDER BY 1"),
      assignments: await ids("SELECT id AS k FROM crew.assignments ORDER BY 1"),
      works: await ids("SELECT id AS k FROM crew.works ORDER BY 1"),
    };
  });

const ROLLBACK = new Error("rollback");
async function attempt(identity: string | null, sqls: string[]): Promise<void> {
  await db
    .withIdentity(identity, async (tx) => {
      for (const sql of sqls) await tx.exec(sql);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
}

const NONE = { sources: [], assignments: [], works: [] };
const BLUEWING = { sources: ["inbox"], assignments: ["a-inbox"], works: ["w-inbox"] };

describe("非 repo 類的來源：讀取", () => {
  it.each([
    ["沒有身分", null, NONE],
    ["guest", "guest", NONE],
    ["staff", "staff", BLUEWING],
    ["lead（測試用）", "lead", BLUEWING],
    ["manager", "manager", { sources: ["feed", "inbox", "wiki"], assignments: ["a-feed", "a-inbox", "a-wiki"], works: ["w-feed", "w-inbox", "w-wiki"] }],
  ] as const)("%s", async (_name, identity, expected) => {
    expect(await read(identity)).toEqual(expected);
  });
});

const assign = (source: string) => [
  `INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id) VALUES ('a-new', '${source}', NULL, 'New', 'docs', 'basil')`,
  "INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('w-new', 'a-new', 1, NULL, 'New')",
];

describe("非 repo 類的來源：新增", () => {
  it("看得到的來源可以交辦與交件，外部編號為空", async () => {
    await expect(attempt("lead", assign("inbox"))).resolves.toBeUndefined();
  });

  it.each([["wiki"], ["feed"]])("看不到的來源（%s）不能交辦", async (source) => {
    await expect(attempt("lead", assign(source).slice(0, 1))).rejects.toThrow("row-level security");
  });

  it("看不到的來源的交辦不能交件", async () => {
    await expect(
      attempt("lead", ["INSERT INTO crew.works (id, assignment_id, round, summary) VALUES ('x', 'a-wiki', 2, 'X')"]),
    ).rejects.toThrow("row-level security");
  });

  it.each([[null], ["guest"], ["staff"]])("%s 不能交辦", async (identity) => {
    await expect(attempt(identity, assign("inbox").slice(0, 1))).rejects.toThrow("row-level security");
  });

  it("kk_app 不能新增、修改或刪除來源", async () => {
    await expect(
      attempt("manager", ["INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('x', 'mailbox', 'X', 'bluewing')"]),
    ).rejects.toThrow("permission denied");
    await expect(attempt("manager", ["UPDATE crew.sources SET kind = 'repo'"])).rejects.toThrow("permission denied");
    await expect(attempt("manager", ["DELETE FROM crew.sources"])).rejects.toThrow("permission denied");
  });
});

describe("欄位層級的 INSERT 權限沿用到改名後的欄位", () => {
  it("kk_app 的 INSERT 欄位", async () => {
    const columns = await db.withIdentity(null, async (tx) =>
      (
        await tx.query<{ table_name: string; column_name: string }>(
          `SELECT table_name, column_name FROM information_schema.column_privileges
           WHERE grantee = 'kk_app' AND privilege_type = 'INSERT' AND table_schema = 'crew'
             AND table_name IN ('sources', 'assignments', 'works')
           ORDER BY table_name, column_name`,
        )
      ).rows.map((r) => `${r.table_name}.${r.column_name}`),
    );
    expect(columns).toEqual([
      // due_at、priority：0006 加入（#133）
      "assignments.assigned_by", "assignments.due_at", "assignments.employee_id", "assignments.external_ref", "assignments.id",
      "assignments.priority", "assignments.source_id", "assignments.title", "assignments.work_type_id",
      "works.assignment_id", "works.body", "works.external_ref", "works.id", "works.round", "works.summary",
    ]);
  });
});
