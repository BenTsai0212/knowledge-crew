// 守則進知識庫的越權與寫入測試（#149，crew ADR 0007 決定 7）：守則確認時在同一個交易寫入文件、段落與 crew.guideline_documents，
// 一律受 RLS 檢查；等確認、不採用不寫，收回不刪、不改文件。原文面板的「這條守則的來歷」（readGuidelineOrigin()）的可見範圍。
// 用到被禁止的語句（superuser 匯入測試用的身分），所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createReview, decideGuideline, proposeGuideline } from "../../src/crew/db/store";
import { DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import type { DemoFile } from "../../src/crew/demo/types";
import { crewStrings } from "../../src/crew/i18n";
import { guidelineDocumentId, identityName, toGuidelineDocument } from "../../src/crew/knowledge/guideline-document";
import { readFlowbackOrigin, readGuidelineOrigin } from "../../src/crew/knowledge/origin";
import { openDatabase, type Database } from "../../src/db/database";

const { access } = clientConfig;
const language = clientConfig.client.defaultLanguage;
const demo = DEMO_RAW as DemoFile;
const t = crewStrings("knowledge", language);
// demo.json：確認過的 g01、g03、g04（之後收回）、g05（員工提、修改後確認）有文件；等確認的 g02、不採用的 g06 沒有
const SEEDED = ["g01", "g03", "g04", "g05"].map(guidelineDocumentId);

// 只在這個測試中的虛構身分（client/access.json 不改），都屬青翼專案、能驗收：clerk 沒有上傳權限；junior 能上傳但只看得到公開等級
async function seedWith(raw: unknown, pg: PGliteInterface): Promise<void> {
  await demoSeed(raw, clientConfig)(pg);
  await pg.exec(`
    INSERT INTO kk.identities (id, visibility_level_id, can_review, can_upload) VALUES
      ('clerk', 'confidential', true, false), ('junior', 'public', true, true);
    INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ('clerk', 'bluewing'), ('junior', 'bluewing');
  `);
}

let db: Database;
const open = async (raw: unknown = DEMO_RAW) => (db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: (pg) => seedWith(raw, pg) }));
afterEach(async () => {
  await db?.close();
});

const ids = (identity: string | null, sql: string, params: unknown[] = []) =>
  db.withIdentity(identity, async (tx) => (await tx.query<{ k: string }>(sql, params)).rows.map((r) => r.k));
const guidelineDocs = (identity: string | null) => ids(identity, "SELECT document_id AS k FROM crew.guideline_documents ORDER BY 1");
const documents = (identity: string | null) => ids(identity, "SELECT id AS k FROM kk.documents WHERE id LIKE 'crew-guideline-%' ORDER BY 1");
const passages = (identity: string | null, doc: string) =>
  ids(identity, "SELECT content AS k FROM kk.passages WHERE document_id = $1 ORDER BY ordinal", [doc]);
const documentRow = (doc: string) =>
  db.withIdentity("manager", async (tx) =>
    (await tx.query(
      `SELECT title, language, visibility_level_id AS level, project_id AS project, document_date::text AS date, uploaded_by AS "uploadedBy"
       FROM kk.documents WHERE id = $1`, [doc],
    )).rows[0],
  );

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const manager = identityName(access, "manager", language);

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

describe("demo 的匯入", { timeout: 60_000 }, () => {
  it("g01、g03、g04、g05 有文件，g02、g06 沒有；文件是預設語言、內部等級、來源交辦的專案、確認者上傳、確認日", async () => {
    await open();
    expect(await guidelineDocs("manager")).toEqual(SEEDED);
    expect(await documents("manager")).toEqual(SEEDED);
    expect(await documentRow(guidelineDocumentId("g01"))).toEqual({
      title: expect.any(String), language, level: "internal", project: "bluewing", date: "2026-09-17", uploadedBy: "manager",
    });
    expect(await documentRow(guidelineDocumentId("g04"))).toMatchObject({ project: "longpier", date: "2026-09-02" });
  });

  it("段落是守則目前的文字與來歷：人提（g01）、員工提且修改後確認（g05）", async () => {
    await open();
    const g01 = demo.guidelines.find((g) => g.id === "g01")!;
    expect(await passages("manager", guidelineDocumentId("g01"))).toEqual(
      toGuidelineDocument({
        employeeName: "Rowan", workTypeId: "support", text: g01.text[language], proposerKind: "human", returnDate: "2026-09-17",
        reason: "different_approach", confirmerName: manager, confirmDate: "2026-09-17", revised: false,
      }, language).passages,
    );
    const g05 = demo.guidelines.find((g) => g.id === "g05")!;
    const [text, origin] = await passages("manager", guidelineDocumentId("g05"));
    expect(text).toBe(g05.decisions[0].revisedText![language]);
    expect(origin).toContain("Linden");
    expect(origin).toContain(t.guidelineDocRevised);
    expect(origin).toContain(t.guidelineDocDrafted.replace("{employee}", "Linden"));
    // 人提的沒有「整理提出」與「確認時修改」
    const [, humanOrigin] = await passages("manager", guidelineDocumentId("g01"));
    expect(humanOrigin).not.toContain(t.guidelineDocRevised);
    expect(humanOrigin).not.toContain(t.guidelineDocDrafted.replace("{employee}", "Rowan"));
  });

  it("可見範圍：manager 四份；staff 只有青翼專案的 g01、g03；guest、沒有身分都沒有", async () => {
    await open();
    expect(await guidelineDocs("manager")).toEqual(SEEDED);
    expect(await guidelineDocs("staff")).toEqual(["g01", "g03"].map(guidelineDocumentId));
    expect(await documents("staff")).toEqual(["g01", "g03"].map(guidelineDocumentId));
    for (const identity of ["guest", null]) {
      expect(await guidelineDocs(identity), String(identity)).toEqual([]);
      expect(await documents(identity), String(identity)).toEqual([]);
    }
  });
});

describe("確認時寫入", { timeout: 60_000 }, () => {
  it("員工提的 g02 確認 → 同一個交易寫入文件；原文的來歷是生效中、之後依照 0 次", async () => {
    await open();
    expect(await decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm" }, { date: "2026-11-25" })).toMatchObject({ guidelineDocument: "written" });
    const doc = guidelineDocumentId("g02");
    expect(await guidelineDocs("manager")).toEqual([...SEEDED, doc].sort());
    expect(await documentRow(doc)).toMatchObject({ project: "bluewing", level: "internal", date: "2026-11-25", uploadedBy: "manager" });
    const g02 = demo.guidelines.find((g) => g.id === "g02")!;
    const [text, origin] = await passages("manager", doc);
    expect(text).toBe(g02.text[language]);
    expect(origin).toContain(t.guidelineDocDrafted.replace("{employee}", "Rowan"));
    expect(origin).toContain("2026-11-25");
    expect(await guidelineDocs("staff")).toContain(doc);

    expect(await readGuidelineOrigin(db, "manager", doc, language)).toMatchObject({
      guidelineId: "g02", employeeId: "rowan", workTypeId: "support", text: g02.text[language], proposerKind: "employee",
      assignmentId: "s12", reason: "wrong", confirmedBy: "manager", revised: false, revokedAt: null, followed: 0,
    });
    // 守則的文件不是回流的文件
    expect(await readFlowbackOrigin(db, "manager", doc, language)).toBeNull();
  });

  it("修改後確認：文件寫修改後的文字，來歷註明確認時修改", async () => {
    await open();
    await decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm", revisedText: "Ask for the transaction time first" });
    const [text, origin] = await passages("manager", guidelineDocumentId("g02"));
    expect(text).toBe("Ask for the transaction time first");
    expect(origin).toContain(t.guidelineDocRevised);
    expect(await readGuidelineOrigin(db, "manager", guidelineDocumentId("g02"), language)).toMatchObject({ revised: true });
  });

  it("人退回時記成守則：同一個交易寫入守則、確認與文件（人提，沒有「整理提出」）", async () => {
    await open();
    // 待驗收的 s14（客服信箱）：退回並記成守則
    const saved = await createReview(db, "manager", { workId: "s14-w1", verdict: "returned", reason: "wrong", note: "Cite the policy page", saveAsGuideline: true });
    expect(saved.guidelineDocument).toBe("written");
    const [text, origin] = await passages("manager", guidelineDocumentId(saved.guidelineId!));
    expect(text).toBe("Cite the policy page");
    expect(origin).toContain(crewStrings("review", language).reasonWrong);
    expect(origin).toContain(manager);
    expect(origin).toContain(today());
    expect(origin).not.toContain(t.guidelineDocRevised);
  });

  it("等確認、不採用不寫文件；收回後文件仍在、內容不變，原文的來歷是已收回", async () => {
    await open();
    expect(await decideGuideline(db, "manager", { guidelineId: "g02", decision: "reject" })).toMatchObject({ guidelineDocument: "not-applicable" });
    // 新提的守則（等確認）也沒有文件
    await proposeGuideline(db, "manager", { sourceReviewId: "s12-1", text: "Confirm the card digits first" });
    expect(await guidelineDocs("manager")).toEqual(SEEDED);

    const doc = guidelineDocumentId("g01");
    const before = await passages("manager", doc);
    expect(await readGuidelineOrigin(db, "manager", doc, language)).toMatchObject({ revokedAt: null });
    expect(await decideGuideline(db, "manager", { guidelineId: "g01", decision: "revoke" })).toMatchObject({ guidelineDocument: "not-applicable" });
    expect(await guidelineDocs("manager")).toEqual(SEEDED);
    expect(await passages("manager", doc)).toEqual(before);
    expect((await readGuidelineOrigin(db, "manager", doc, language))?.revokedAt).toEqual(expect.any(String));
    // demo 中已收回的 g04
    expect(await readGuidelineOrigin(db, "manager", guidelineDocumentId("g04"), language)).toMatchObject({
      employeeId: "linden", revokedAt: new Date("2026-10-20T10:00:00+08:00").toISOString(),
    });
  });

  it("確認者沒有上傳權限：確認照常寫入、守則生效，不寫文件", async () => {
    await open();
    expect(await decideGuideline(db, "clerk", { guidelineId: "g02", decision: "confirm" })).toMatchObject({ guidelineDocument: "no-upload-permission" });
    expect(await ids("manager", "SELECT decision AS k FROM crew.guideline_decisions WHERE guideline_id = 'g02'")).toEqual(["confirm"]);
    expect(await guidelineDocs("manager")).toEqual(SEEDED);
  });

  it("來源沒有守則等級：確認照常寫入，不寫文件；demo 匯入同樣不寫", async () => {
    const raw = structuredClone(DEMO_RAW) as DemoFile;
    for (const s of raw.sources) if (s.id === "support-inbox") delete s.guidelineVisibility;
    await open(raw);
    // g01 來自客服信箱：匯入時不寫
    expect(await guidelineDocs("manager")).toEqual(SEEDED.filter((d) => d !== guidelineDocumentId("g01")));
    expect(await decideGuideline(db, "manager", { guidelineId: "g02", decision: "confirm" })).toMatchObject({ guidelineDocument: "not-applicable" });
    expect(await ids("manager", "SELECT decision AS k FROM crew.guideline_decisions WHERE guideline_id = 'g02'")).toEqual(["confirm"]);
    expect(await documents("manager")).not.toContain(guidelineDocumentId("g02"));
  });

  it("寫不進來源等級的身分（junior 只看得到公開）：整筆確認回滾", async () => {
    await open();
    await expect(decideGuideline(db, "junior", { guidelineId: "g02", decision: "confirm" })).rejects.toThrow(/row-level security/);
    expect(await ids("manager", "SELECT decision AS k FROM crew.guideline_decisions WHERE guideline_id = 'g02'")).toEqual([]);
  });
});

describe("原文的來歷：看不到守則的身分不顯示", { timeout: 60_000 }, () => {
  it("staff 看得到 g01、看不到 g04；guest、沒有身分都是 null", async () => {
    await open();
    expect(await readGuidelineOrigin(db, "staff", guidelineDocumentId("g01"), language)).toMatchObject({ guidelineId: "g01", followed: expect.any(Number) });
    expect(await readGuidelineOrigin(db, "staff", guidelineDocumentId("g04"), language)).toBeNull();
    for (const identity of ["guest", null]) {
      expect(await readGuidelineOrigin(db, identity, guidelineDocumentId("g01"), language), String(identity)).toBeNull();
    }
    // 回流的文件不是守則的文件
    expect(await readGuidelineOrigin(db, "manager", "crew-k12-w1", language)).toBeNull();
  });

  it("g01 之後依照的次數：只算看得到的交件", async () => {
    await open();
    const followed = await ids("manager", "SELECT work_id AS k FROM crew.work_guidelines WHERE guideline_id = 'g01'");
    expect(followed.length).toBeGreaterThan(0);
    expect((await readGuidelineOrigin(db, "manager", guidelineDocumentId("g01"), language))?.followed).toBe(followed.length);
  });
});

describe("越權寫入（crew 0008 的 policy 與欄位授權）", { timeout: 60_000 }, () => {
  // g02 的確認與文件：以 manager 寫入時合法；每一項只改一個條件
  const confirm = (by = "manager") =>
    `INSERT INTO crew.guideline_decisions (id, guideline_id, decision, decided_by) VALUES ('g02-c', 'g02', 'confirm', '${by}')`;
  const doc = (opts: { level?: string; project?: string; by?: string } = {}) =>
    `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, uploaded_by)
     VALUES ('crew-guideline-g02', 'T', '${language}', '${opts.level ?? "internal"}', '${opts.project ?? "bluewing"}', '${opts.by ?? "manager"}')`;
  const link = (confirmId = "g02-c") =>
    `INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id) VALUES ('g02', 'crew-guideline-g02', '${confirmId}')`;

  it("合法的寫入可以成功（以下各項只差一個條件）", async () => {
    await open();
    expect(await attempt("manager", [confirm(), doc(), link()])).toBeNull();
  });

  it.each([
    ["文件的機密等級不是來源的守則等級", [confirm(), doc({ level: "public" }), link()]],
    ["文件的專案不是來源交辦的專案", [confirm(), doc({ project: "longpier" }), link()]],
  ])("%s 被拒", async (_name, sqls) => {
    await open();
    expect(await attempt("manager", sqls)).toMatch(/row-level security/);
  });

  it("確認不是自己寫的（clerk 確認、manager 寫文件）被拒", async () => {
    await open();
    await decideGuideline(db, "clerk", { guidelineId: "g02", decision: "confirm" });
    const [clerkConfirm] = await ids("manager", "SELECT id AS k FROM crew.guideline_decisions WHERE guideline_id = 'g02'");
    expect(await attempt("manager", [doc(), link(clerkConfirm)])).toMatch(/row-level security/);
  });

  it("沒有 can_review 的 staff、沒有身分都不能寫入", async () => {
    await open();
    expect(await attempt("staff", [doc({ by: "staff" }), link("g01-d1")])).toMatch(/row-level security|permission denied/);
    expect(await attempt(null, [link("g01-d1")])).toMatch(/row-level security|permission denied/);
  });

  it("指向不採用的決定被拒（g06）；收回不能改或刪文件與紀錄；不能指定時間", async () => {
    await open();
    expect(await attempt("manager", [
      `INSERT INTO kk.documents (id, title, language, visibility_level_id, project_id, uploaded_by)
       VALUES ('crew-guideline-g06', 'T', '${language}', 'internal', 'longpier', 'manager')`,
      "INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id) VALUES ('g06', 'crew-guideline-g06', 'g06-d1')",
    ])).toMatch(/foreign key|row-level security/);
    expect(await attempt("manager", ["UPDATE crew.guideline_documents SET confirm_id = confirm_id"])).toMatch(/permission denied/);
    expect(await attempt("manager", ["DELETE FROM crew.guideline_documents"])).toMatch(/permission denied/);
    expect(await attempt("manager", [
      confirm(), doc(),
      "INSERT INTO crew.guideline_documents (guideline_id, document_id, confirm_id, created_at) VALUES ('g02', 'crew-guideline-g02', 'g02-c', now())",
    ])).toMatch(/permission denied/);
  });
});
