// 知識庫條目回流的越權測試（#92）：驗收通過時寫入的文件、段落與 crew.knowledge_flowbacks 一律受 RLS 檢查。
// 用到被禁止的語句（superuser 匯入測試用的身分），所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createReview } from "../../src/crew/db/store";
import { readFlowbackOrigin, readFlowbackPassage } from "../../src/crew/knowledge/origin";
import { readGraph } from "../../src/graph/read";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import type { DemoFile } from "../../src/crew/demo/types";
import { openDatabase, type Database } from "../../src/db/database";
import { expectedVisible } from "../db/oracle";

const { access } = clientConfig;
const WORK = "k13-w1"; // demo.json 待驗收的知識庫條目（公司知識庫：長堤專案，回流等級 internal）
const DOC = `crew-${WORK}`;
const OWNER = `pe-crew-${WORK}-owner`; // #owner 的待審實體；新建的部門實體 id 相同（第 1 筆決定的 id，0009）
const SEEDED = "crew-k12-w1"; // demo.json 已通過的 k12：seed 時就回流（#92 的計畫第 5 節）

// 只在這個測試中的虛構身分（client/access.json 不改），都屬長堤專案、能驗收：
// clerk 沒有上傳權限；junior 能上傳但只看得到公開等級（寫不進 internal 的文件）
async function seed(pg: PGliteInterface): Promise<void> {
  await demoSeed(DEMO_RAW, clientConfig)(pg);
  await pg.exec(`
    INSERT INTO kk.identities (id, visibility_level_id, can_review, can_upload) VALUES
      ('clerk', 'confidential', true, false), ('junior', 'public', true, true);
    INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ('clerk', 'longpier'), ('junior', 'longpier');
  `);
}

let db: Database;
const open = async () => (db = await openDatabase(clientConfig, { migrations: crewMigrations, seed }));
afterEach(async () => {
  await db?.close();
});

const ids = (identity: string | null, sql: string, params: unknown[] = []) =>
  db.withIdentity(identity, async (tx) => (await tx.query<{ k: string }>(sql, params)).rows.map((r) => r.k));

// 回流的資料：文件、段落、回流紀錄與這份工作的驗收；以 superuser 以外的身分讀，RLS 照常套用
const flowed = async (identity: string | null) => ({
  documents: await ids(identity, "SELECT id AS k FROM kk.documents WHERE id = $1", [DOC]),
  passages: await ids(identity, "SELECT id AS k FROM kk.passages WHERE document_id = $1 ORDER BY ordinal", [DOC]),
  flowbacks: await ids(identity, "SELECT document_id AS k FROM crew.knowledge_flowbacks WHERE document_id = $1", [DOC]),
  // 出處在這份文件的實體（#owner → 部門）
  entities: await ids(
    identity,
    "SELECT DISTINCT es.entity_id AS k FROM kk.entity_sources es JOIN kk.passages p ON p.id = es.passage_id WHERE p.document_id = $1 ORDER BY 1",
    [DOC],
  ),
  reviews: await ids(identity, "SELECT verdict AS k FROM crew.reviews WHERE work_id = $1", [WORK]),
});

// 依序執行後一律 rollback；成功時回傳 null，被拒絕時回傳錯誤訊息
const ROLLBACK = new Error("rollback");
async function attempt(identity: string | null, sqls: string[]): Promise<string | null> {
  try {
    await db.withIdentity(identity, async (tx) => {
      for (const sql of sqls) await tx.exec(sql);
      throw ROLLBACK;
    });
  } catch (e) {
    return e === ROLLBACK ? null : (e as Error).message;
  }
  return null;
}

describe("驗收通過時回流", { timeout: 60_000 }, () => {
  it("主管通過 k13：同一個交易寫入文件、段落與回流紀錄；每個身分的可見範圍與 oracle 相同", async () => {
    await open();
    expect(await createReview(db, "manager", { workId: WORK, verdict: "accepted" }, { date: "2026-11-22" })).toMatchObject({ flowback: "flowed" });

    const doc = await db.withIdentity("manager", async (tx) =>
      (await tx.query(
        `SELECT title, language, visibility_level_id AS level, project_id AS project, document_date::text AS date, uploaded_by AS "uploadedBy"
         FROM kk.documents WHERE id = $1`, [DOC],
      )).rows[0],
    );
    expect(doc).toEqual({
      title: "預購商品說明", language: clientConfig.client.defaultLanguage, level: "internal", project: "longpier",
      date: "2026-11-22", uploadedBy: "manager",
    });
    const passages = await db.withIdentity("manager", async (tx) =>
      (await tx.query<{ content: string }>("SELECT content FROM kk.passages WHERE document_id = $1 ORDER BY ordinal", [DOC])).rows.map((r) => r.content),
    );
    // 負責部門、付款方式、到貨時間、取消規則；空白的生效日期不寫
    expect(passages).toHaveLength(4);
    expect(passages[0]).toBe("負責部門\n電商營運組");

    const ids = passages.map((_, i) => `${DOC}-${i + 1}`);
    const sample = {
      docs: [{ id: DOC, level: "internal", project: "longpier" }],
      passages: ids.map((id) => ({ id, doc: DOC, level: "internal", project: "longpier" })),
      // #owner → 部門（負責部門是第 1 段）
      entities: [{ id: OWNER, sources: [`${DOC}-1`] }],
      relations: [],
    };
    for (const identity of [...access.roles.map((r) => r.id), null]) {
      const visible = expectedVisible(access, sample, identity);
      const got = await flowed(identity);
      expect(got.documents, String(identity)).toEqual(visible.documents);
      expect(got.passages, String(identity)).toEqual(visible.passages);
      expect(got.entities, String(identity)).toEqual(visible.entities);
      // 回流紀錄：驗收與文件都看得到時才看得到
      expect(got.flowbacks, String(identity)).toEqual(visible.documents.length > 0 && got.reviews.length > 0 ? [DOC] : []);
    }
    // 主管以外看不到長堤專案：一般員工與訪客都看不到
    expect((await flowed("staff")).documents).toEqual([]);
    expect((await flowed("manager")).flowbacks).toEqual([DOC]);

    // 圖譜：新的部門「電商營運組」，出處是負責部門那一段；核准者是驗收者、人做的決定（manual）
    const team = (await readGraph(db, "manager")).entities.find((e) => e.id === OWNER);
    expect(team).toMatchObject({ type: "team", name: "電商營運組" });
    const decision = await db.withIdentity("manager", async (tx) =>
      (await tx.query("SELECT decision, decided_by AS by, mode, merge_into AS merge FROM kk.review_decisions WHERE item_id = $1", [OWNER])).rows,
    );
    expect(decision).toEqual([{ decision: "approve", by: "manager", mode: "manual", merge: null }]);
  });

  it("退回不回流；沒有回流等級的來源、不是知識庫條目的工作也不回流", async () => {
    await open();
    expect(await createReview(db, "manager", { workId: WORK, verdict: "returned", reason: "wrong" })).toMatchObject({ flowback: "not-applicable" });
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], entities: [], reviews: ["returned"] });

    // 其他來源（沒有回流等級）的待驗收工作：通過也不寫入任何文件
    const pending = await ids(
      "manager",
      `SELECT w.id AS k FROM crew.works w JOIN crew.assignments a ON a.id = w.assignment_id
       WHERE a.source_id <> 'company-kb' AND NOT EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.work_id = w.id) ORDER BY 1 LIMIT 1`,
    );
    expect(pending).toHaveLength(1);
    expect(await createReview(db, "manager", { workId: pending[0], verdict: "accepted" })).toMatchObject({ flowback: "not-applicable" });
    expect(await ids(null, "SELECT 1::text AS k FROM crew.knowledge_flowbacks")).toEqual([]);
    expect(await ids("manager", "SELECT document_id AS k FROM crew.knowledge_flowbacks")).toEqual([SEEDED]);
  });

  it("驗收者沒有上傳權限：驗收照常通過、不回流", async () => {
    await open();
    expect(await createReview(db, "clerk", { workId: WORK, verdict: "accepted" })).toMatchObject({ flowback: "no-upload-permission" });
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], entities: [], reviews: ["accepted"] });
  });

  it("任一步被 RLS 拒絕時整筆驗收回滾：寫不進 internal 文件的驗收者，驗收也不成立", async () => {
    await open();
    await expect(createReview(db, "junior", { workId: WORK, verdict: "accepted" })).rejects.toThrow(/row-level security/);
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], entities: [], reviews: [] });
  });

  it("同一份交件不能驗收兩次，所以不會回流兩次", async () => {
    await open();
    await createReview(db, "manager", { workId: WORK, verdict: "accepted" });
    await expect(createReview(db, "manager", { workId: WORK, verdict: "accepted" })).rejects.toThrow(/unique/);
    const got = await flowed("manager");
    expect(got.flowbacks).toEqual([DOC]);
    expect(got.reviews).toEqual(["accepted"]);
  });
});

describe("crew.knowledge_flowbacks 的寫入規則", { timeout: 60_000 }, () => {
  const review = (id: string, verdict: "accepted" | "returned") =>
    `INSERT INTO crew.reviews (id, work_id, verdict, reason, decided_by) VALUES ('${id}', '${WORK}', '${verdict}', ${
      verdict === "returned" ? "'wrong'" : "NULL"
    }, kk.current_identity_id())`;
  const document = (id: string, level = "internal") =>
    `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, uploaded_by)
     VALUES ('${id}', 'T', 'en', '${level}', 'longpier', kk.current_identity_id())`;
  const flowback = (reviewId: string, documentId: string) =>
    `INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('${reviewId}', '${documentId}')`;

  it("照規則寫入時成功（對照組）", async () => {
    await open();
    expect(await attempt("manager", [review("r1", "accepted"), document(DOC), flowback("r1", DOC)])).toBeNull();
  });

  it.each([
    ["退回的驗收", [review("r1", "returned"), document(DOC), flowback("r1", DOC)]],
    ["文件 id 不是 crew-<工作 id>", [review("r1", "accepted"), document("crew-other"), flowback("r1", "crew-other")]],
    ["文件的機密等級不是來源的回流等級", [review("r1", "accepted"), document(DOC, "confidential"), flowback("r1", DOC)]],
    // k12-1 是主管寫的已通過驗收，文件 id 也不符
    ["別份工作的驗收", [document(DOC), flowback("k12-1", DOC)]],
  ])("拒絕：%s", async (_name, sqls) => {
    await open();
    expect(await attempt("manager", sqls)).toMatch(/row-level security/);
  });

  it("拒絕：別人上傳的文件、沒有 can_review 的身分；不能指定時間欄位", async () => {
    await open();
    // clerk 的驗收配上主管上傳的文件（clerk 沒有上傳權限，以主管先寫入的文件測試）
    expect(await attempt("manager", [document(DOC), "SELECT set_config('kk.identity_id', 'clerk', true)", review("r1", "accepted"), flowback("r1", DOC)]))
      .toMatch(/row-level security|permission denied/);
    expect(await attempt("staff", [flowback("k12-1", DOC)])).toMatch(/row-level security/);
    expect(
      await attempt("manager", [review("r1", "accepted"), document(DOC), `INSERT INTO crew.knowledge_flowbacks (review_id, document_id, created_at) VALUES ('r1', '${DOC}', now())`]),
    ).toMatch(/permission denied/);
  });
});

describe("seed 時回流與部門的合併", { timeout: 60_000 }, () => {
  const IDENTITIES = [...access.roles.map((r) => r.id), null];
  const SEEDED_OWNER = "pe-crew-k12-w1-owner";

  it("demo.json 已通過的 k12：seed 後就有文件、段落、回流紀錄與「採購組」；圖譜對每個身分與 oracle 相同", async () => {
    await open();
    const doc = await db.withIdentity("manager", async (tx) =>
      (await tx.query(
        `SELECT title, visibility_level_id AS level, project_id AS project, document_date::text AS date, uploaded_by AS "uploadedBy"
         FROM kk.documents WHERE id = $1`, [SEEDED],
      )).rows[0],
    );
    expect(doc).toEqual({ title: "供應商下單流程", level: "internal", project: "longpier", date: "2026-10-27", uploadedBy: "manager" });
    const passages = await ids("manager", "SELECT id AS k FROM kk.passages WHERE document_id = $1 ORDER BY ordinal", [SEEDED]);
    // 負責部門、步驟、最後更新
    expect(passages).toEqual([1, 2, 3].map((n) => `${SEEDED}-${n}`));
    const flowback = await db.withIdentity("manager", async (tx) =>
      (await tx.query("SELECT review_id AS review, created_at = '2026-10-27T15:00:00+08:00'::timestamptz AS at FROM crew.knowledge_flowbacks WHERE document_id = $1", [SEEDED])).rows,
    );
    expect(flowback).toEqual([{ review: "k12-1", at: true }]);

    const sample = {
      docs: [{ id: SEEDED, level: "internal", project: "longpier" }],
      passages: passages.map((id) => ({ id, doc: SEEDED, level: "internal", project: "longpier" })),
      entities: [{ id: SEEDED_OWNER, sources: [`${SEEDED}-1`] }],
      relations: [],
    };
    for (const identity of IDENTITIES) {
      const graph = await readGraph(db, identity);
      expect(graph.entities.map((e) => e.id), String(identity)).toEqual(expectedVisible(access, sample, identity).entities);
    }
    expect((await readGraph(db, "manager")).entities[0]).toMatchObject({ type: "team", name: "採購組" });
    // 一般員工與訪客看不到長堤專案的回流
    expect((await readGraph(db, "staff")).entities).toEqual([]);
  });

  it("名稱與既有部門相同（aliasRules）時合併：不新建實體，既有部門多一個出處", async () => {
    // 既有的部門「電商營運組」，出處在主管看得到的 k12 回流段落；k13 的負責部門前後與中間多了空白（aliasRules 的 ignoreWhitespace）
    const merged = async (pg: PGliteInterface) => {
      await seed(pg);
      await pg.exec(`
        INSERT INTO kk.entities (id, entity_type, name, names) VALUES ('team-ecom', 'team', '電商營運組', '{"zh-TW": "電商營運組", "en": "E-commerce"}');
        INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES ('team-ecom', '${SEEDED}-2');
        UPDATE crew.works SET body = replace(body, '\n電商營運組\n', '\n 電商 營運組 \n') WHERE id = '${WORK}';
      `);
    };
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: merged });
    await createReview(db, "manager", { workId: WORK, verdict: "accepted" });
    const graph = await readGraph(db, "manager");
    expect(graph.entities.some((e) => e.id === OWNER)).toBe(false);
    expect(graph.entities.find((e) => e.id === "team-ecom")!.sources.map((p) => p.id).sort()).toEqual([`${SEEDED}-2`, `${DOC}-1`]);
    const decision = await db.withIdentity("manager", async (tx) =>
      (await tx.query("SELECT merge_into AS merge FROM kk.review_decisions WHERE item_id = $1", [OWNER])).rows,
    );
    expect(decision).toEqual([{ merge: "team-ecom" }]);
    expect((await flowed("manager")).entities).toEqual(["team-ecom"]);
  });

  it("同名的部門有兩個以上時不自動選擇：段落照常回流，不寫進圖譜", async () => {
    const ambiguous = async (pg: PGliteInterface) => {
      await seed(pg);
      await pg.exec(`
        INSERT INTO kk.entities (id, entity_type, name, names) VALUES
          ('team-a', 'team', '電商營運組', '{}'), ('team-b', 'team', '電商營運組', '{}');
        INSERT INTO kk.entity_sources (entity_id, passage_id) VALUES ('team-a', '${SEEDED}-2'), ('team-b', '${SEEDED}-3');
      `);
    };
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: ambiguous });
    expect(await createReview(db, "manager", { workId: WORK, verdict: "accepted" })).toMatchObject({ flowback: "flowed" });
    const got = await flowed("manager");
    expect(got.passages).toHaveLength(4);
    expect(got.entities).toEqual([]);
    expect(await ids("manager", "SELECT id AS k FROM kk.pending_entities WHERE document_id = $1", [DOC])).toEqual([]);
  });

  it("部門的寫入被拒絕時整筆驗收回滾（文件、段落、部門與回流紀錄都沒有）", async () => {
    // 先佔用部門的待審 id：寫入待審實體時主鍵衝突
    const taken = async (pg: PGliteInterface) => {
      await seed(pg);
      await pg.exec(`INSERT INTO kk.pending_entities (id, document_id, entity_type, names) VALUES ('${OWNER}', '${SEEDED}', 'team', '{}')`);
    };
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: taken });
    await expect(createReview(db, "manager", { workId: WORK, verdict: "accepted" })).rejects.toThrow(/duplicate key|unique/);
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], entities: [], reviews: [] });
  });
});

// 原文的「這條知識經過的把關」（#147；原本是「來自 AI 員工 ○○」）與「已收進知識庫」讀的回流紀錄（#92 PR 3）：看得到驗收與文件的身分才有
describe("回流的來源", { timeout: 60_000 }, () => {
  const lang = clientConfig.client.defaultLanguage;
  const origin = (identity: string | null, doc: string) => readFlowbackOrigin(db, identity, doc, lang);

  it("seed 時回流的 k12：主管讀到員工、交辦與驗收時間；一般員工、訪客、沒有身分讀不到", async () => {
    await open();
    expect(await origin("manager", SEEDED)).toEqual({
      assignmentId: "k12", title: (DEMO_RAW as DemoFile).assignments.find((a) => a.id === "k12")!.title[lang], employeeName: "Linden",
      decidedAt: new Date("2026-10-27T15:00:00+08:00").toISOString(),
      // 知識的來歷（#147）：驗收者、當時看重點、第一次就通過、檢查 2/2、依照守則 1 條（g05）
      decidedBy: "manager", level: "light", returned: 0, checks: { passed: 2, total: 2 }, guidelines: 1,
    });
    expect(await readFlowbackPassage(db, "manager", "k12-w1")).toBe(`${SEEDED}-1`);
    for (const identity of ["staff", "guest", null]) {
      expect(await origin(identity, SEEDED), String(identity)).toBeNull();
      expect(await readFlowbackPassage(db, identity, "k12-w1"), String(identity)).toBeNull();
    }
  });

  it("通過 k13 之後才有來源；不是回流的文件與退回的工作沒有", async () => {
    await open();
    expect(await origin("manager", DOC)).toBeNull();
    expect(await readFlowbackPassage(db, "manager", WORK)).toBeNull();
    await createReview(db, "manager", { workId: WORK, verdict: "accepted" });
    expect(await origin("manager", DOC)).toMatchObject({ assignmentId: "k13", employeeName: "Linden" });
    expect(await readFlowbackPassage(db, "manager", WORK)).toBe(`${DOC}-1`);
    expect(await origin("staff", DOC)).toBeNull();
    // 資料集的文件不是回流的文件
    const [plain] = await ids("manager", "SELECT id AS k FROM kk.documents WHERE id NOT LIKE 'crew-%' ORDER BY id LIMIT 1");
    expect(await origin("manager", plain)).toBeNull();
  });

  it("沒有上傳權限的驗收者通過：沒有回流紀錄，所以沒有來源", async () => {
    await open();
    await createReview(db, "clerk", { workId: WORK, verdict: "accepted" });
    expect(await readFlowbackPassage(db, "manager", WORK)).toBeNull();
    expect(await origin("manager", DOC)).toBeNull();
  });
});
