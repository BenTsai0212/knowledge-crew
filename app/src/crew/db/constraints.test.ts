// crew 0002 的 CHECK 與 UNIQUE（#26）、0004 的工作來源與外部編號（#57）、0005 的知識庫回流（#92）、0007 的守則（#142）與 0008 的守則文件（#149）與 0009 的事後更正、逐條回饋（#161）。superuser 的 PGlite，寫法同 migrate.test.ts 的 bare()。
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate";
import { crewMigrations } from "./migrate";

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    CREATE ROLE kk_owner NOLOGIN; CREATE ROLE kk_app NOLOGIN;
    CREATE SCHEMA kk; CREATE SCHEMA kk_meta; CREATE SCHEMA crew;
  `);
  await applyMigrations(pg);
  await applyMigrations(pg, crewMigrations);
  await pg.exec(`
    INSERT INTO kk.visibility_levels (id, rank) VALUES ('internal', 0);
    INSERT INTO kk.projects (id) VALUES ('bluewing');
    INSERT INTO kk.identities (id, visibility_level_id) VALUES ('manager', 'internal');
    INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('lantern', 'repo', 'example-org/lantern-notes', 'bluewing');
    INSERT INTO crew.employees (id, display_name) VALUES ('juniper', 'Juniper');
    INSERT INTO crew.work_types (id) VALUES ('ui');
    INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by)
      VALUES ('a1', 'lantern', 1, 'Fix header', 'ui', 'juniper', 'manager');
    INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES
      ('w1', 'a1', 1, 10, 'Header'), ('w2', 'a1', 2, 11, 'Header'), ('w3', 'a1', 3, 12, 'Header');
  `);
}, 30_000);
afterAll(async () => {
  await pg.close();
});

const review = (id: string, work: string, verdict: string, reason: string | null) =>
  `INSERT INTO crew.reviews (id, work_id, verdict, reason, decided_by) VALUES ('${id}', '${work}', '${verdict}', ${reason === null ? "NULL" : `'${reason}'`}, 'manager')`;

describe("crew 0002 的約束", () => {
  it.each([
    ["assignments 的 (source_id, external_ref) 重複", "INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES ('a2', 'lantern', 1, 'X', 'ui', 'juniper', 'manager')", /unique/],
    ["works 的 (assignment_id, round) 重複", "INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('wx', 'a1', 1, 13, 'X')", /unique/],
    ["work_checks.status = running", "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w1', 'test', 'running')", /check constraint/],
    ["reviews.verdict = maybe", review("rx", "w1", "maybe", null), /check constraint/],
    ["reviews.reason = other", review("rx", "w1", "returned", "other"), /check constraint/],
    ["returned 沒有 reason", review("rx", "w1", "returned", null), /check constraint/],
    ["accepted 帶 reason", review("rx", "w1", "accepted", "wrong"), /check constraint/],
    ["level_decisions.decision = pause", "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_by) VALUES ('ld', 'juniper', 'ui', 'pause', 'manager')", /check constraint/],
  ])("%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });

  it("合法的驗收可以寫入；同一個 work_id 第二筆被拒", async () => {
    await pg.exec(review("r1", "w1", "returned", "wrong"));
    await pg.exec(review("r2", "w2", "accepted", null));
    await expect(pg.exec(review("r3", "w1", "accepted", null))).rejects.toThrow(/unique/);
  });

  it("同一檢查可以先 pending 再 pass，兩筆並存", async () => {
    await pg.exec(`
      INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w3', 'test', 'pending');
      INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w3', 'test', 'pass');
    `);
    const rows = await pg.query<{ status: string }>(
      "SELECT status FROM crew.work_checks WHERE work_id = 'w3' AND name = 'test' ORDER BY checked_at, id",
    );
    expect(rows.rows.map((r) => r.status)).toEqual(["pending", "pass"]);
  });
});

describe("crew 0004 的工作來源與外部編號", () => {
  const assignment = (id: string, source: string, ref: string | null) =>
    `INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES ('${id}', '${source}', ${ref === null ? "NULL" : `'${ref}'`}, 'X', 'ui', 'juniper', 'manager')`;

  it("既有的來源是 repo 類；類型只允許四種、一定要指定", async () => {
    expect((await pg.query<{ kind: string }>("SELECT kind FROM crew.sources")).rows).toEqual([{ kind: "repo" }]);
    for (const kind of ["mailbox", "social", "knowledge_base"]) {
      await pg.exec(`INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-${kind}', '${kind}', 'Source ${kind}', 'bluewing')`);
    }
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-x', 'chat', 'X', 'bluewing')")).rejects.toThrow(/check constraint/);
    await expect(pg.exec("INSERT INTO crew.sources (id, name, project_id) VALUES ('s-y', 'Y', 'bluewing')")).rejects.toThrow(/null value/);
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-z', 'mailbox', '', 'bluewing')")).rejects.toThrow(/check constraint/);
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-w', 'mailbox', 'Source mailbox', 'bluewing')")).rejects.toThrow(/unique/);
  });

  it("外部編號可以為空，同一來源可有多筆；有值時同一來源內不重複，不同來源可以重複；空字串被拒", async () => {
    await pg.exec(assignment("n1", "s-mailbox", null));
    await pg.exec(assignment("n2", "s-mailbox", null));
    await pg.exec(assignment("m1", "s-mailbox", "MSG-1"));
    await expect(pg.exec(assignment("m2", "s-mailbox", "MSG-1"))).rejects.toThrow(/unique/);
    await pg.exec(assignment("m3", "s-social", "MSG-1"));
    await expect(pg.exec(assignment("m4", "s-mailbox", ""))).rejects.toThrow(/check constraint/);
    await pg.exec("INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('wn', 'n1', 1, NULL, 'X')");
    await expect(pg.exec("INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('we', 'n2', 1, '', 'X')")).rejects.toThrow(/check constraint/);
  });

  it("限制名稱與表、欄位一致", async () => {
    const names = (await pg.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conname IN ('sources_name_key', 'assignments_source_id_external_ref_key') ORDER BY 1",
    )).rows.map((r) => r.conname);
    expect(names).toEqual(["assignments_source_id_external_ref_key", "sources_name_key"]);
  });
});

describe("crew 0005 的約束（#92）", () => {
  it("回流等級只能填在知識庫類的來源，且是存在的機密等級", async () => {
    const source = (id: string, kind: string, level: string) =>
      `INSERT INTO crew.sources (id, kind, name, project_id, knowledge_visibility_level_id) VALUES ('${id}', '${kind}', '${id}', 'bluewing', '${level}')`;
    await pg.exec(source("kb-ok", "knowledge_base", "internal"));
    await expect(pg.exec(source("kb-repo", "repo", "internal"))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(source("kb-missing", "knowledge_base", "secret"))).rejects.toThrow(/foreign key/);
  });

  // 約束不看驗收的結果（是否「通過」由 policy 檢查），沿用上面寫入的 r1、r2
  it("回流紀錄：一次驗收一份文件，一份文件只來自一次驗收，文件必須存在", async () => {
    await pg.exec(`
      INSERT INTO kk.documents (id, title, language, visibility_level_id) VALUES ('crew-w1', 'T', 'en', 'internal'), ('crew-w2', 'T', 'en', 'internal');
      INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r1', 'crew-w1');
    `);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r1', 'crew-w2')")).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r2', 'crew-w1')")).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r2', 'nowhere')")).rejects.toThrow(/foreign key/);
  });
});

describe("crew 0006 的約束（#133）", () => {
  const insert = (id: string, extra: string, values: string) =>
    `INSERT INTO crew.assignments (id, source_id, title, work_type_id, employee_id, assigned_by${extra}) VALUES ('${id}', 'lantern', 'X', 'ui', 'juniper', 'manager'${values})`;

  it("既有的交辦：沒有到期日、優先順序是 normal", async () => {
    const [a1] = (await pg.query<{ due_at: string | null; priority: string }>("SELECT due_at, priority FROM crew.assignments WHERE id = 'a1'")).rows;
    expect(a1).toEqual({ due_at: null, priority: "normal" });
  });

  it("到期日可以為空；優先順序只允許 high、normal、low，不能是 NULL", async () => {
    await pg.exec(insert("d1", ", due_at, priority", ", '2026-11-20', 'high'"));
    await pg.exec(insert("d2", ", priority", ", 'low'"));
    const rows = (await pg.query<{ id: string; due: string | null; priority: string }>(
      "SELECT id, to_char(due_at, 'YYYY-MM-DD') AS due, priority FROM crew.assignments WHERE id IN ('d1', 'd2') ORDER BY id",
    )).rows;
    expect(rows).toEqual([{ id: "d1", due: "2026-11-20", priority: "high" }, { id: "d2", due: null, priority: "low" }]);
    await expect(pg.exec(insert("d3", ", priority", ", 'urgent'"))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(insert("d4", ", priority", ", NULL"))).rejects.toThrow(/not-null|null value/);
    await expect(pg.exec(insert("d5", ", due_at", ", '2026-02-30'"))).rejects.toThrow();
  });
});

describe("crew 0007 的守則（#142）", () => {
  beforeAll(async () => {
    // juniper × ui 的 a1 沿用上面的資料；另加 rowan × support 的交辦。驗收：可成為守則的 gw1、gw2，不能的 gp（流程）、gn（沒有意見）、ga（通過）
    await pg.exec(`
      INSERT INTO crew.employees (id, display_name) VALUES ('rowan', 'Rowan');
      INSERT INTO crew.work_types (id) VALUES ('support');
      INSERT INTO crew.assignments (id, source_id, title, work_type_id, employee_id, assigned_by) VALUES
        ('ga1', 'lantern', 'G1', 'ui', 'juniper', 'manager'), ('ga2', 'lantern', 'G2', 'support', 'rowan', 'manager');
      INSERT INTO crew.works (id, assignment_id, round, summary) VALUES
        ('gw1', 'ga1', 1, 'X'), ('gw2', 'ga1', 2, 'X'), ('gw3', 'ga1', 3, 'X'), ('gw4', 'ga1', 4, 'X'), ('gw5', 'ga1', 5, 'X'),
        ('gr1', 'ga2', 1, 'X'), ('gr2', 'ga2', 2, 'X');
      INSERT INTO crew.reviews (id, work_id, verdict, reason, note, decided_by) VALUES
        ('gv1', 'gw1', 'returned', 'wrong', '以合約為準', 'manager'),
        ('gv2', 'gw2', 'returned', 'different_approach', '分段寫', 'manager'),
        ('gp', 'gw3', 'returned', 'process', '圖片尺寸不符', 'manager'),
        ('gn', 'gw4', 'returned', 'wrong', '  ', 'manager'),
        ('ga', 'gw5', 'accepted', NULL, '很好', 'manager'),
        ('gvr', 'gr1', 'returned', 'wrong', '先確認末四碼', 'manager');
    `);
  });

  const guideline = (id: string, review: string, work: string, assignment: string, opts: { employee?: string; workType?: string; kind?: string; by?: string | null; text?: string; eligible?: boolean } = {}) =>
    `INSERT INTO crew.guidelines (id, employee_id, work_type_id, text, source_review_id, source_work_id, source_assignment_id, proposer_kind, proposed_by${opts.eligible === false ? ", source_eligible" : ""})
     VALUES ('${id}', '${opts.employee ?? "juniper"}', '${opts.workType ?? "ui"}', '${opts.text ?? "守則"}', '${review}', '${work}', '${assignment}', '${opts.kind ?? "human"}', ${opts.by === null ? "NULL" : `'${opts.by ?? "manager"}'`}${opts.eligible === false ? ", false" : ""})`;
  const decision = (id: string, g: string, kind: string, revised: string | null = null, confirm: string | null = null) =>
    `INSERT INTO crew.guideline_decisions (id, guideline_id, decision, revised_text, confirm_id, decided_by) VALUES ('${id}', '${g}', '${kind}', ${revised === null ? "NULL" : `'${revised}'`}, ${confirm === null ? "NULL" : `'${confirm}'`}, 'manager')`;
  const follow = (work: string, g: string, assignment: string, employee = "juniper", workType = "ui") =>
    `INSERT INTO crew.work_guidelines (work_id, guideline_id, assignment_id, employee_id, work_type_id) VALUES ('${work}', '${g}', '${assignment}', '${employee}', '${workType}')`;

  it("can_be_guideline 由原因與意見推算：只有做錯了或不一樣的做法、而且有意見", async () => {
    const rows = (await pg.query<{ id: string; can_be_guideline: boolean }>(
      "SELECT id, can_be_guideline FROM crew.reviews WHERE id IN ('gv1', 'gv2', 'gp', 'gn', 'ga', 'r1') ORDER BY id",
    )).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.can_be_guideline]))).toEqual({ ga: false, gn: false, gp: false, gv1: true, gv2: true, r1: false });
  });

  it("合法的守則：人提（有提出者）與員工提（提出者是 NULL）", async () => {
    await pg.exec(guideline("g1", "gv1", "gw1", "ga1"));
    await pg.exec(guideline("g2", "gv2", "gw2", "ga1", { kind: "employee", by: null }));
    // 同一次退回可以有多條守則（恢復已收回的守則時提新的一條）
    await pg.exec(guideline("g3", "gv1", "gw1", "ga1", { kind: "employee", by: null }));
    await pg.exec(guideline("gr", "gvr", "gr1", "ga2", { employee: "rowan", workType: "support" }));
  });

  it.each([
    ["來源退回是流程上的小問題", guideline("x", "gp", "gw3", "ga1"), /foreign key/],
    ["來源退回沒有意見", guideline("x", "gn", "gw4", "ga1"), /foreign key/],
    ["來源是通過", guideline("x", "ga", "gw5", "ga1"), /foreign key/],
    ["來源的交件不是那次退回的交件", guideline("x", "gv1", "gw2", "ga1"), /foreign key/],
    ["來源的交辦不是那次交件的交辦", guideline("x", "gv1", "gw1", "ga2"), /foreign key/],
    ["員工和來源交辦不同", guideline("x", "gv1", "gw1", "ga1", { employee: "rowan" }), /foreign key/],
    ["工作類型和來源交辦不同", guideline("x", "gv1", "gw1", "ga1", { workType: "support" }), /foreign key/],
    ["source_eligible 不是 true", guideline("x", "gv1", "gw1", "ga1", { eligible: false }), /check constraint/],
    ["提出者的種類是 robot", guideline("x", "gv1", "gw1", "ga1", { kind: "robot" }), /check constraint/],
    ["人提卻沒有提出者", guideline("x", "gv1", "gw1", "ga1", { by: null }), /check constraint/],
    ["員工提卻有提出者", guideline("x", "gv1", "gw1", "ga1", { kind: "employee" }), /check constraint/],
    ["文字是空白", guideline("x", "gv1", "gw1", "ga1", { text: "  " }), /check constraint/],
  ])("守則：%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });

  it.each([
    ["決定是 pause", decision("x", "g2", "pause"), /check constraint/],
    ["不採用帶修改的文字", decision("x", "g2", "reject", "改寫"), /check constraint/],
    ["收回帶修改的文字", decision("x", "g2", "revoke", "改寫"), /check constraint/],
    ["收回沒有指向確認", decision("x", "g2", "revoke"), /check constraint/],
    ["確認卻指向確認", decision("x", "g2", "confirm", null, "g1-d1"), /check constraint/],
    ["確認的修改文字是空白", decision("x", "g2", "confirm", " "), /check constraint/],
    ["守則不存在", decision("x", "nowhere", "confirm"), /foreign key/],
  ])("決定：%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });

  it("確認與不採用合計只有一次、收回只有一次；收回要指向同一守則的確認；修改後確認可以寫入", async () => {
    await pg.exec(decision("g1-d1", "g1", "confirm"));
    await expect(pg.exec(decision("g1-d2", "g1", "confirm"))).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec(decision("g1-d2", "g1", "reject"))).rejects.toThrow(/unique|duplicate key/);
    await pg.exec(decision("g1-d3", "g1", "revoke", null, "g1-d1"));
    await expect(pg.exec(decision("g1-d4", "g1", "revoke", null, "g1-d1"))).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec(decision("g1-d5", "g1", "confirm"))).rejects.toThrow(/unique|duplicate key/);
    await pg.exec(decision("g2-d1", "g2", "reject"));
    await expect(pg.exec(decision("g2-d2", "g2", "confirm"))).rejects.toThrow(/unique|duplicate key/);
    // 沒有確認不能收回：指向不採用、別的守則的確認、收回、不存在的決定都被拒
    await expect(pg.exec(decision("g2-d3", "g2", "revoke", null, "g2-d1"))).rejects.toThrow(/foreign key/);
    await expect(pg.exec(decision("g2-d3", "g2", "revoke", null, "g1-d1"))).rejects.toThrow(/foreign key/);
    await expect(pg.exec(decision("g1-d6", "g1", "revoke", null, "g1-d3"))).rejects.toThrow(/foreign key|unique|duplicate key/);
    await expect(pg.exec(decision("g3-d0", "g3", "revoke", null, "nowhere"))).rejects.toThrow(/foreign key/);
    await pg.exec(decision("g3-d1", "g3", "confirm", "以合約為準，註明出處"));
  });

  it("依照的守則：員工 × 工作類型要和交件相同，交件與交辦要一致，同一守則不重複", async () => {
    await pg.exec(follow("gw2", "g3", "ga1"));
    await expect(pg.exec(follow("gw2", "g3", "ga1"))).rejects.toThrow(/unique|duplicate key/);
    // rowan 的交件依照 juniper 的守則：不論填交件的還是守則的員工 × 工作類型，都有一邊的外鍵失敗
    await expect(pg.exec(follow("gr2", "g3", "ga2", "rowan", "support"))).rejects.toThrow(/foreign key/);
    await expect(pg.exec(follow("gr2", "g3", "ga2", "juniper", "ui"))).rejects.toThrow(/foreign key/);
    await expect(pg.exec(follow("gr2", "g3", "ga1"))).rejects.toThrow(/foreign key/);
    await pg.exec(follow("gr2", "gr", "ga2", "rowan", "support"));
  });

  describe("crew 0008 的守則文件（#149）", () => {
    const gdoc = (g: string, doc: string, confirm: string) =>
      `INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id) VALUES ('${g}', '${doc}', '${confirm}')`;

    beforeAll(async () => {
      await pg.exec(`
        INSERT INTO kk.documents (id, title, language, visibility_level_id) VALUES
          ('crew-guideline-g1', 'T', 'en', 'internal'), ('crew-guideline-g2', 'T', 'en', 'internal'),
          ('crew-guideline-g3', 'T', 'en', 'internal'), ('other-doc', 'T', 'en', 'internal');
      `);
    });

    it("守則等級可以為空、任何類型的來源都可以填，必須是存在的機密等級", async () => {
      expect((await pg.query("SELECT guideline_visibility_level_id AS v FROM crew.sources WHERE id = 'lantern'")).rows).toEqual([{ v: null }]);
      await pg.exec("UPDATE crew.sources SET guideline_visibility_level_id = 'internal' WHERE id = 'lantern'");
      await expect(pg.exec("UPDATE crew.sources SET guideline_visibility_level_id = 'secret' WHERE id = 'lantern'")).rejects.toThrow(/foreign key/);
    });

    it.each([
      ["文件 id 不是 crew-guideline-<守則 id>", gdoc("g3", "other-doc", "g3-d1"), /check constraint/],
      ["文件 id 是別的守則的", gdoc("g3", "crew-guideline-g1", "g3-d1"), /check constraint/],
      ["依據的是不採用", gdoc("g2", "crew-guideline-g2", "g2-d1"), /foreign key/],
      ["依據的是別的守則的確認", gdoc("g3", "crew-guideline-g3", "g1-d1"), /foreign key/],
      ["依據的是收回", gdoc("g1", "crew-guideline-g1", "g1-d3"), /foreign key/],
      ["文件不存在", gdoc("gr", "crew-guideline-gr", "g1-d1"), /foreign key/],
      ["指定 confirm_decision", "INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id, confirm_decision) VALUES ('g3', 'crew-guideline-g3', 'g3-d1', 'confirm')", /generated|non-DEFAULT/],
    ])("守則文件：%s 被拒", async (_name, sql, error) => {
      await expect(pg.exec(sql)).rejects.toThrow(error);
    });

    it("合法的守則文件（已收回的守則也留著）；一條守則一份、一份文件一條守則", async () => {
      await pg.exec(gdoc("g1", "crew-guideline-g1", "g1-d1"));
      await pg.exec(gdoc("g3", "crew-guideline-g3", "g3-d1"));
      await expect(pg.exec(gdoc("g1", "crew-guideline-g1", "g1-d1"))).rejects.toThrow(/unique|duplicate key/);
      expect((await pg.query("SELECT guideline_id AS g, confirm_decision AS d FROM crew.guideline_documents ORDER BY 1")).rows).toEqual([
        { g: "g1", d: "confirm" }, { g: "g3", d: "confirm" },
      ]);
    });
  });
});

describe("crew 0009 的事後更正、逐條回饋與「沒被標成重點」（#161）", () => {
  // 沿用 0007 的資料：ga（gw5 通過，有意見）、gv1（gw1 做錯了）、gv2（gw2 不一樣的做法，gw2 依照 g3）、r2（w2 通過）
  beforeAll(async () => {
    await pg.exec(`
      INSERT INTO crew.works (id, assignment_id, round, summary) VALUES ('gw6', 'ga1', 6, 'X'), ('gw7', 'ga1', 7, 'X'), ('gw8', 'ga1', 8, 'X');
      INSERT INTO crew.work_points (work_id, ordinal, text) VALUES ('gw2', 1, 'P1'), ('gw2', 2, 'P2'), ('gw1', 1, 'P1');
      INSERT INTO crew.reviews (id, work_id, verdict, reason, note, decided_by) VALUES ('ga2', 'gw8', 'accepted', NULL, NULL, 'manager');
    `);
  });

  const reviewWith = (id: string, work: string, verdict: string, reason: string | null, notInPoints: boolean) =>
    `INSERT INTO crew.reviews (id, work_id, verdict, reason, not_in_points, decided_by) VALUES ('${id}', '${work}', '${verdict}', ${reason === null ? "NULL" : `'${reason}'`}, ${notInPoints}, 'manager')`;
  const correction = (id: string, review: string, note: string | null, verdict?: string) =>
    `INSERT INTO crew.review_corrections (id, review_id, note, corrected_by${verdict ? ", review_verdict" : ""}) VALUES ('${id}', '${review}', ${note === null ? "NULL" : `'${note}'`}, 'manager'${verdict ? `, '${verdict}'` : ""})`;
  const feedback = (review: string, work: string, kind: string, ordinal: number | null, guideline: string | null, result: string) =>
    `INSERT INTO crew.review_feedback (review_id, work_id, target_kind, point_ordinal, guideline_id, result) VALUES ('${review}', '${work}', '${kind}', ${ordinal ?? "NULL"}, ${guideline === null ? "NULL" : `'${guideline}'`}, '${result}')`;
  const fromCorrection = (id: string, c: string | null, review: string, work: string, eligible: "NULL" | "true" | "DEFAULT" = "NULL") =>
    `INSERT INTO crew.guidelines (id, employee_id, work_type_id, text, source_review_id, source_work_id, source_assignment_id, proposer_kind, proposed_by, source_correction_id, source_eligible)
     VALUES ('${id}', 'juniper', 'ui', '守則', '${review}', '${work}', 'ga1', 'human', 'manager', ${c === null ? "NULL" : `'${c}'`}, ${eligible})`;

  it("沒被標成重點：既有的驗收是 false；只有退回且原因是做錯了時可以是 true", async () => {
    expect((await pg.query("SELECT DISTINCT not_in_points AS v FROM crew.reviews")).rows).toEqual([{ v: false }]);
    await pg.exec(reviewWith("np1", "gw6", "returned", "wrong", true));
    await expect(pg.exec(reviewWith("np2", "gw7", "returned", "different_approach", true))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(reviewWith("np2", "gw7", "returned", "process", true))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(reviewWith("np2", "gw7", "accepted", null, true))).rejects.toThrow(/check constraint/);
  });

  it("事後更正：只能更正通過的驗收，一次驗收最多一筆；can_be_guideline 由備註推算", async () => {
    await pg.exec(correction("c1", "ga", "其實漏了退款條件"));
    await pg.exec(correction("c2", "ga2", "  "));
    await expect(pg.exec(correction("c3", "ga", "再一次"))).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec(correction("c3", "gv1", "退回不能更正"))).rejects.toThrow(/foreign key/);
    await expect(pg.exec(correction("c3", "gv1", "假裝是通過", "returned"))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(correction("c3", "nowhere", "X"))).rejects.toThrow(/foreign key/);
    const rows = (await pg.query<{ id: string; g: boolean; n: boolean }>(
      "SELECT id, can_be_guideline AS g, not_in_points AS n FROM crew.review_corrections ORDER BY id",
    )).rows;
    expect(rows).toEqual([{ id: "c1", g: true, n: false }, { id: "c2", g: false, n: false }]);
  });

  it("逐條回饋：合法的重點與守則；同一對象最多一筆", async () => {
    await pg.exec(feedback("gv2", "gw2", "point", 1, null, "ok"));
    await pg.exec(feedback("gv2", "gw2", "point", 2, null, "problem"));
    await pg.exec(feedback("gv2", "gw2", "guideline", null, "g3", "not_done"));
    await expect(pg.exec(feedback("gv2", "gw2", "point", 1, null, "problem"))).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec(feedback("gv2", "gw2", "guideline", null, "g3", "done"))).rejects.toThrow(/unique|duplicate key/);
  });

  it.each([
    ["重點不是該次交件的", feedback("gv1", "gw1", "point", 2, null, "ok"), /foreign key/],
    ["守則不是該次交件依照的", feedback("gv1", "gw1", "guideline", null, "g3", "done"), /foreign key/],
    ["交件不是該次驗收的", feedback("gv1", "gw2", "point", 1, null, "ok"), /foreign key/],
    ["種類是 change", feedback("gv2", "gw2", "change", 1, null, "ok"), /check constraint/],
    ["重點卻沒有序號", feedback("gv2", "gw2", "point", null, null, "ok"), /check constraint/],
    ["重點卻帶守則", feedback("gv2", "gw2", "point", 1, "g3", "ok"), /check constraint/],
    ["守則卻帶序號", feedback("gv2", "gw2", "guideline", 1, "g3", "done"), /check constraint/],
    ["重點的結果是 done", feedback("gv2", "gw2", "point", 1, null, "done"), /check constraint/],
    ["守則的結果是 ok", feedback("gv2", "gw2", "guideline", null, "g3", "ok"), /check constraint/],
  ])("逐條回饋：%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });

  it("更正記成守則：source_eligible 是 NULL、更正有備註、驗收與交件對得上", async () => {
    await pg.exec(fromCorrection("gc1", "c1", "ga", "gw5"));
    expect((await pg.query("SELECT source_eligible AS e, source_correction_eligible AS c FROM crew.guidelines WHERE id = 'gc1'")).rows)
      .toEqual([{ e: null, c: true }]);
    // 0007 的守則不受影響：source_eligible 是 true、source_correction_id 是 NULL
    expect((await pg.query("SELECT DISTINCT source_eligible AS e FROM crew.guidelines WHERE source_correction_id IS NULL")).rows)
      .toEqual([{ e: true }]);
  });

  it.each([
    ["更正的備註是空白", fromCorrection("x", "c2", "ga2", "gw8"), /foreign key/],
    ["更正不是那次驗收的", fromCorrection("x", "c1", "ga2", "gw8"), /foreign key/],
    ["驗收不是那次交件的", fromCorrection("x", "c1", "ga", "gw8"), /foreign key/],
    ["更正來源卻帶 source_eligible", fromCorrection("x", "c1", "ga", "gw5", "true"), /check constraint/],
    ["退回來源卻沒有 source_eligible", fromCorrection("x", null, "gv1", "gw1"), /check constraint/],
    ["更正不存在", fromCorrection("x", "nowhere", "ga", "gw5"), /foreign key/],
  ])("更正來源的守則：%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });
});
