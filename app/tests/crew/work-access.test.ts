// crew 的交辦、工作與驗收的越權測試（#26）。用到被禁止的語句，所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { openDatabase, type Database } from "../../src/db/database";

// 虛構資料，以 superuser 匯入（時間欄位可以填過去的時間）。
// lead 是只在這個測試中的虛構身分：有 can_review、只屬青翼，用來測「有權限但看不到的 repo」（client/access.json 不改）
async function seed(pg: PGliteInterface): Promise<void> {
  await pg.exec(`
    INSERT INTO kk.identities (id, visibility_level_id, can_review) VALUES ('lead', 'internal', true);
    INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ('lead', 'bluewing');
    INSERT INTO crew.repos (id, full_name, project_id) VALUES
      ('lantern', 'example-org/lantern-notes', 'bluewing'),
      ('harbor', 'example-org/harbor-docs', 'longpier');
    INSERT INTO crew.employees (id, display_name) VALUES ('juniper', 'Juniper'), ('basil', 'Basil');
    INSERT INTO crew.work_types (id) VALUES ('ui'), ('docs');
    INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by, assigned_at) VALUES
      ('a-lantern', 'lantern', 1, 'Fix header', 'ui', 'juniper', 'manager', '2026-01-01'),
      ('a-harbor', 'harbor', 1, 'Write guide', 'docs', 'basil', 'manager', '2026-01-01');
    INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES
      ('w-lantern', 'a-lantern', 1, 10, 'Header'), ('w-harbor', 'a-harbor', 1, 20, 'Guide');
    INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ('w-lantern', 1, 'Layout'), ('w-harbor', 1, 'Tone');
    INSERT INTO crew.work_changes (work_id, ordinal, path, summary) VALUES ('w-lantern', 1, 'a.css', ''), ('w-harbor', 1, 'b.md', '');
    INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w-lantern', 'test', 'pass'), ('w-harbor', 'test', 'fail');
    INSERT INTO crew.reviews (id, work_id, verdict, reason, decided_by) VALUES
      ('r-lantern', 'w-lantern', 'returned', 'wrong', 'manager'), ('r-harbor', 'w-harbor', 'accepted', NULL, 'manager');
    INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_by) VALUES
      ('ld-juniper', 'juniper', 'ui', 'relax', 'manager'), ('ld-basil', 'basil', 'docs', 'relax', 'manager');
  `);
}

// 每張表用來比對的欄位
const KEYS = {
  assignments: "id", works: "id", work_points: "work_id", work_changes: "work_id",
  work_checks: "work_id", reviews: "id", level_decisions: "id",
} as const;
const TABLES = Object.keys(KEYS) as (keyof typeof KEYS)[];
const NONE = Object.fromEntries(TABLES.map((t) => [t, []]));
const LANTERN = {
  assignments: ["a-lantern"], works: ["w-lantern"], work_points: ["w-lantern"], work_changes: ["w-lantern"],
  work_checks: ["w-lantern"], reviews: ["r-lantern"], level_decisions: ["ld-juniper"],
};
const ALL = {
  assignments: ["a-harbor", "a-lantern"], works: ["w-harbor", "w-lantern"], work_points: ["w-harbor", "w-lantern"],
  work_changes: ["w-harbor", "w-lantern"], work_checks: ["w-harbor", "w-lantern"], reviews: ["r-harbor", "r-lantern"],
  level_decisions: ["ld-basil", "ld-juniper"],
};

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed });
});
afterAll(async () => {
  await db.close();
});

const readAll = (identity: string | null) =>
  db.withIdentity(identity, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const t of TABLES) {
      out[t] = (await tx.query<{ k: string }>(`SELECT ${KEYS[t]} AS k FROM crew.${t} ORDER BY 1`)).rows.map((r) => r.k);
    }
    return out;
  });

// 依序執行後一律 rollback，不影響其他測試；全部成功時回傳 check 查詢的結果
const ROLLBACK = new Error("rollback");
async function attempt(identity: string | null, sqls: string[], check?: string): Promise<unknown> {
  let result: unknown;
  await db
    .withIdentity(identity, async (tx) => {
      for (const sql of sqls) await tx.exec(sql);
      if (check) result = (await tx.query(check)).rows;
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return result;
}

const MATRIX: [string, string | null, Record<string, string[]>][] = [
  ["沒有身分", null, NONE],
  ["不存在的身分", "nobody", NONE],
  ["guest", "guest", NONE],
  ["staff", "staff", LANTERN],
  ["lead（測試用）", "lead", LANTERN],
  ["manager", "manager", ALL],
];

describe("讀取", () => {
  it.each(MATRIX)("%s", async (_name, identity, expected) => {
    expect(await readAll(identity)).toEqual(expected);
  });
});

// 對某個交辦（與其工作）新增：交辦、交件（工作與其下三張表）、驗收、少看的決定
const flow = (repo: string, n: number, type: string, employee: string) => [
  `INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id) VALUES ('a-new', '${repo}', ${n}, 'New', '${type}', '${employee}')`,
  "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('w-new', 'a-new', 1, 99, 'New')",
  "INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ('w-new', 1, 'Point')",
  "INSERT INTO crew.work_changes (work_id, ordinal, path, summary) VALUES ('w-new', 1, 'x.ts', '')",
  "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w-new', 'test', 'pending')",
  "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w-new', 'test', 'pass')",
  "INSERT INTO crew.reviews (id, work_id, verdict) VALUES ('r-new', 'w-new', 'accepted')",
  `INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, basis_review_id) VALUES ('ld-new', '${employee}', '${type}', 'relax', 'r-new')`,
];

// 對既有的資料逐表新增一筆（無權限的身分用）
const EACH = [
  ["assignments", "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by) VALUES ('x', 'lantern', 9, 'X', 'ui', 'juniper', 'manager')"],
  ["works", "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('x', 'a-lantern', 2, 11, 'X')"],
  ["work_points", "INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ('w-lantern', 2, 'X')"],
  ["work_changes", "INSERT INTO crew.work_changes (work_id, ordinal, path, summary) VALUES ('w-lantern', 2, 'x', '')"],
  ["work_checks", "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w-lantern', 'x', 'pass')"],
  ["reviews", "INSERT INTO crew.reviews (id, work_id, verdict, decided_by) VALUES ('x', 'w-lantern', 'accepted', 'manager')"],
  ["level_decisions", "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_by) VALUES ('x', 'juniper', 'ui', 'revoke', 'manager')"],
] as const;

describe("新增", () => {
  it("manager 可以交辦、交件、驗收、少看的決定；寫入者與時間由預設值填入", async () => {
    const rows = await attempt(
      "manager",
      flow("harbor", 2, "docs", "basil"),
      `SELECT
        (SELECT assigned_by = 'manager' AND assigned_at = now() FROM crew.assignments WHERE id = 'a-new') AS assignment,
        (SELECT submitted_at = now() FROM crew.works WHERE id = 'w-new') AS work,
        (SELECT count(*) FROM crew.work_checks WHERE work_id = 'w-new' AND checked_at = now())::int AS checks,
        (SELECT decided_by = 'manager' AND decided_at = now() FROM crew.reviews WHERE id = 'r-new') AS review,
        (SELECT decided_by = 'manager' AND decided_at = now() FROM crew.level_decisions WHERE id = 'ld-new') AS decision`,
    );
    expect(rows).toEqual([{ assignment: true, work: true, checks: 2, review: true, decision: true }]);
  });

  it.each(
    [null, "guest", "staff"].flatMap((identity) => EACH.map(([table, sql]) => [identity ?? "沒有身分", table, identity, sql] as const)),
  )("%s 不能新增 %s", async (_name, _table, identity, sql) => {
    await expect(attempt(identity, [sql])).rejects.toThrow("row-level security");
  });

  it("有 can_review 的身分可以在看得到的 repo 交辦到驗收", async () => {
    await expect(attempt("lead", flow("lantern", 2, "ui", "juniper"))).resolves.toBeUndefined();
  });

  it.each([
    ["交辦", "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id) VALUES ('x', 'harbor', 9, 'X', 'docs', 'basil')"],
    ["交件", "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('x', 'a-harbor', 2, 21, 'X')"],
    ["重點", "INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ('w-harbor', 2, 'X')"],
    ["變更", "INSERT INTO crew.work_changes (work_id, ordinal, path, summary) VALUES ('w-harbor', 2, 'x', '')"],
    ["檢查", "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w-harbor', 'x', 'pass')"],
    ["驗收", "INSERT INTO crew.reviews (id, work_id, verdict, reason) VALUES ('x', 'w-harbor', 'returned', 'process')"],
    ["少看的決定", "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision) VALUES ('x', 'basil', 'docs', 'relax')"],
  ] as const)("看不到的 repo 不能%s", async (_name, sql) => {
    await expect(attempt("lead", [sql])).rejects.toThrow("row-level security");
  });

  it.each([
    ["assignments.assigned_by", ["INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by) VALUES ('x', 'lantern', 9, 'X', 'ui', 'juniper', 'lead')"]],
    ["reviews.decided_by", ["INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('w2', 'a-lantern', 2, 11, 'X')", "INSERT INTO crew.reviews (id, work_id, verdict, decided_by) VALUES ('x', 'w2', 'accepted', 'lead')"]],
    ["level_decisions.decided_by", ["INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_by) VALUES ('x', 'juniper', 'ui', 'revoke', 'lead')"]],
  ])("冒名：%s 不是自己時被拒", async (_name, sqls) => {
    await expect(attempt("manager", sqls)).rejects.toThrow("row-level security");
  });

  // juniper × docs 的驗收（r-x），用來測少看的決定的依據必須是同一員工 × 同一類工作
  const juniperDocs = [
    "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id) VALUES ('a-x', 'lantern', 3, 'X', 'docs', 'juniper')",
    "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('w-x', 'a-x', 1, 12, 'X')",
    "INSERT INTO crew.reviews (id, work_id, verdict) VALUES ('r-x', 'w-x', 'accepted')",
  ];
  it.each([
    ["同一員工 × 同一類工作可以", "juniper', 'docs", true],
    ["其他工作類型的驗收被拒", "juniper', 'ui", false],
    ["其他員工的驗收被拒", "basil', 'docs", false],
  ])("少看的決定的依據：%s", async (_name, target, ok) => {
    const run = attempt("manager", [...juniperDocs, `INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, basis_review_id) VALUES ('ld-x', '${target}', 'relax', 'r-x')`]);
    if (ok) await expect(run).resolves.toBeUndefined();
    else await expect(run).rejects.toThrow("row-level security");
  });

  it.each([
    ["assignments.assigned_at", "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_at) VALUES ('x', 'lantern', 9, 'X', 'ui', 'juniper', now() + interval '1 day')"],
    ["works.submitted_at", "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary, submitted_at) VALUES ('x', 'a-lantern', 2, 11, 'X', now())"],
    ["work_checks.checked_at", "INSERT INTO crew.work_checks (work_id, name, status, checked_at) VALUES ('w-lantern', 'x', 'pass', '2030-01-01')"],
    ["reviews.decided_at", "INSERT INTO crew.reviews (id, work_id, verdict, decided_at) VALUES ('x', 'w-lantern', 'accepted', '2030-01-01')"],
    ["level_decisions.decided_at", "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_at) VALUES ('x', 'juniper', 'ui', 'relax', '2030-01-01')"],
  ])("不能自行指定 %s", async (_name, sql) => {
    await expect(attempt("manager", [sql])).rejects.toThrow("permission denied");
  });
});

describe("kk_app 不能修改或刪除", () => {
  it.each(TABLES.flatMap((t) => [[`${t} UPDATE`, `UPDATE crew.${t} SET ${KEYS[t]} = ${KEYS[t]}`], [`${t} DELETE`, `DELETE FROM crew.${t}`]]))(
    "%s 失敗",
    async (_name, sql) => {
      await expect(attempt("manager", [sql])).rejects.toThrow("permission denied");
    },
  );

  it.each(
    TABLES.flatMap((t) => [
      `ALTER TABLE crew.${t} DISABLE ROW LEVEL SECURITY`,
      `ALTER TABLE crew.${t} NO FORCE ROW LEVEL SECURITY`,
      `DROP POLICY can_see ON crew.${t}`,
    ]),
  )("%s 失敗", async (sql) => {
    await expect(attempt("manager", [sql])).rejects.toThrow("must be owner");
  });

  it("失敗之後讀取結果不變", async () => {
    for (const [name, identity, expected] of MATRIX) expect(await readAll(identity), name).toEqual(expected);
  });
});
