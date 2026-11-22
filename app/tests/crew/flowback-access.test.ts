// 知識庫條目回流的越權測試（#92）：驗收通過時寫入的文件、段落與 crew.knowledge_flowbacks 一律受 RLS 檢查。
// 用到被禁止的語句（superuser 匯入測試用的身分），所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createReview } from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { openDatabase, type Database } from "../../src/db/database";
import { expectedVisible } from "../db/oracle";

const { access } = clientConfig;
const WORK = "k13-w1"; // demo.json 待驗收的知識庫條目（公司知識庫：長堤專案，回流等級 internal）
const DOC = `crew-${WORK}`;

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
  flowbacks: await ids(identity, "SELECT document_id AS k FROM crew.knowledge_flowbacks"),
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
      entities: [],
      relations: [],
    };
    for (const identity of [...access.roles.map((r) => r.id), null]) {
      const visible = expectedVisible(access, sample, identity);
      const got = await flowed(identity);
      expect(got.documents, String(identity)).toEqual(visible.documents);
      expect(got.passages, String(identity)).toEqual(visible.passages);
      // 回流紀錄：驗收與文件都看得到時才看得到
      expect(got.flowbacks, String(identity)).toEqual(visible.documents.length > 0 && got.reviews.length > 0 ? [DOC] : []);
    }
    // 主管以外看不到長堤專案：一般員工與訪客都看不到
    expect((await flowed("staff")).documents).toEqual([]);
    expect((await flowed("manager")).flowbacks).toEqual([DOC]);
  });

  it("退回不回流；沒有回流等級的來源、不是知識庫條目的工作也不回流", async () => {
    await open();
    expect(await createReview(db, "manager", { workId: WORK, verdict: "returned", reason: "wrong" })).toMatchObject({ flowback: "not-applicable" });
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], reviews: ["returned"] });

    // 其他來源（沒有回流等級）的待驗收工作：通過也不寫入任何文件
    const pending = await ids(
      "manager",
      `SELECT w.id AS k FROM crew.works w JOIN crew.assignments a ON a.id = w.assignment_id
       WHERE a.source_id <> 'company-kb' AND NOT EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.work_id = w.id) ORDER BY 1 LIMIT 1`,
    );
    expect(pending).toHaveLength(1);
    expect(await createReview(db, "manager", { workId: pending[0], verdict: "accepted" })).toMatchObject({ flowback: "not-applicable" });
    expect(await ids(null, "SELECT 1::text AS k FROM crew.knowledge_flowbacks")).toEqual([]);
    expect(await ids("manager", "SELECT document_id AS k FROM crew.knowledge_flowbacks")).toEqual([]);
  });

  it("驗收者沒有上傳權限：驗收照常通過、不回流", async () => {
    await open();
    expect(await createReview(db, "clerk", { workId: WORK, verdict: "accepted" })).toMatchObject({ flowback: "no-upload-permission" });
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], reviews: ["accepted"] });
  });

  it("任一步被 RLS 拒絕時整筆驗收回滾：寫不進 internal 文件的驗收者，驗收也不成立", async () => {
    await open();
    await expect(createReview(db, "junior", { workId: WORK, verdict: "accepted" })).rejects.toThrow(/row-level security/);
    expect(await flowed("manager")).toEqual({ documents: [], passages: [], flowbacks: [], reviews: [] });
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
