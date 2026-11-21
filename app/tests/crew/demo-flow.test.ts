// 一次完整流程，只用資料層（#29）：交辦 → 模擬交件 → 退回「做錯了」→ Linden × knowledge 從 light 變回 item，autoResets 多一筆。
// 對照組：退回「我想要不一樣的做法」時層級維持 light。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { createAssignment, createReview, getTrustInputs } from "../../src/crew/db/store";
import { DEMO, DEMO_RAW } from "../../src/crew/demo/load";
import { demoSeed } from "../../src/crew/demo/seed";
import { simulateSubmission } from "../../src/crew/demo/simulate";
import type { DemoFile } from "../../src/crew/demo/types";
import { autoResets, reviewLevel } from "../../src/crew/trust/rules";
import type { ReturnReason } from "../../src/crew/trust/types";
import { openDatabase, type Database } from "../../src/db/database";

let db: Database;
beforeEach(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterEach(() => db.close());

const lindenKnowledge = async () => {
  const { reviews, decisions } = await getTrustInputs(db, "manager", "linden", "knowledge");
  return { level: reviewLevel(reviews, decisions), resets: autoResets(reviews, decisions) };
};

const assignSubmitReturn = async (reason: ReturnReason) => {
  const a = await createAssignment(db, "manager", { sourceId: "company-kb", title: "Merge FAQ entries", workTypeId: "knowledge", employeeId: "linden" });
  const { workId } = await simulateSubmission(db, "manager", a.id, DEMO as DemoFile, "zh-TW");
  return createReview(db, "manager", { workId, verdict: "returned", reason });
};

describe("交辦 → 模擬交件 → 退回", () => {
  it("退回「做錯了」：Linden × knowledge 變回 item，autoResets 多一筆", async () => {
    const before = await lindenKnowledge();
    expect(before).toEqual({ level: "light", resets: [] });
    const { id } = await assignSubmitReturn("wrong");
    const after = await lindenKnowledge();
    expect(after.level).toBe("item");
    expect(after.resets).toHaveLength(before.resets.length + 1);
    expect(after.resets.at(-1)!.review).toMatchObject({ id, verdict: "returned", reason: "wrong" });
  });

  it("對照組：退回「我想要不一樣的做法」時維持 light", async () => {
    await assignSubmitReturn("different_approach");
    expect(await lindenKnowledge()).toEqual({ level: "light", resets: [] });
  });
});
