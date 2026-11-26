// 驗收面板的「這次依照的守則」（#147）：純函式（交件當時的文字、來歷、之後已收回）、匯入虛構資料後的面板資料、
// 等確認的提示只給能驗收的身分，以及面板的呈現（沒有依照任何守則時不顯示區塊）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fill } from "../../../client/i18n";
import { clientConfig } from "../../../client/load";
import { openDatabase, type Database } from "../../../db/database";
import { crewMigrations } from "../../db/migrate";
import type { StoredGuideline } from "../../db/store";
import { DEMO_RAW } from "../../demo/load";
import { demoSeed } from "../../demo/seed";
import type { DemoFile } from "../../demo/types";
import { crewStrings } from "../../i18n";
import { readReviewPanel } from "../review";
import { canReviewOf } from "../today";
import { followedGuidelines, pendingGuidelineCount } from "./followed";
import { ReviewPanel } from "./ReviewPanel";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const t = crewStrings("review", lang);
const demoText = (id: string) => demo.guidelines.find((g) => g.id === id)!.text[lang];

const guideline = (over: Partial<StoredGuideline>): StoredGuideline => ({
  id: "x1",
  employeeId: "e",
  workTypeId: "w",
  text: "proposed",
  currentText: "proposed",
  status: "active",
  sourceReviewId: "r",
  sourceWorkId: "w1",
  sourceAssignmentId: "a",
  sourceCorrectionId: null,
  notDoneCount: 0,
  sourceReview: null,
  proposerKind: "employee",
  proposedBy: null,
  proposedAt: "2026-10-01T00:00:00.000Z",
  decisions: [],
  ...over,
});

describe("followedGuidelines（純函式）", () => {
  it("員工提：文字是交件以前確認時修改的文字，來歷是確認的日期", () => {
    const g = guideline({
      decisions: [{ id: "x1-d1", decision: "confirm", revisedText: "revised", decidedBy: "manager", decidedAt: "2026-10-02T00:00:00.000Z" }],
    });
    expect(followedGuidelines([g], "2026-10-05T00:00:00.000Z", lang)).toEqual([
      { id: "x1", text: "revised", proposerKind: "employee", since: "2026-10-02T00:00:00.000Z", retiredLater: false },
    ]);
  });

  it("人提：來歷是退回時記下的時間；交件之後收回的標成「之後已收回」", () => {
    const g = guideline({
      proposerKind: "human",
      proposedBy: "manager",
      status: "revoked",
      decisions: [
        { id: "x1-d1", decision: "confirm", revisedText: null, decidedBy: "manager", decidedAt: "2026-10-01T00:00:00.000Z" },
        { id: "x1-d2", decision: "revoke", revisedText: null, decidedBy: "manager", decidedAt: "2026-10-09T00:00:00.000Z" },
      ],
    });
    const [before] = followedGuidelines([g], "2026-10-05T00:00:00.000Z", lang);
    expect(before).toMatchObject({ text: "proposed", proposerKind: "human", since: "2026-10-01T00:00:00.000Z", retiredLater: true });
  });

  it("等確認的守則數只給能驗收的身分", () => {
    const list = [{ status: "pending" as const }, { status: "active" as const }, { status: "pending" as const }];
    expect(pendingGuidelineCount(list, true)).toBe(2);
    expect(pendingGuidelineCount(list, false)).toBe(0);
  });
});

describe("readReviewPanel 的守則：匯入虛構資料後", () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  });
  afterAll(() => db.close());
  const panel = (identity: string, id: string) => readReviewPanel(db, identity, lang, id, canReviewOf(clientConfig.access, identity));

  it("manager 打開 s14（Rowan）：依照 g01（退回時記下），g02 等確認 1 條", async () => {
    const p = (await panel("manager", "s14"))!;
    expect(p.guidelines).toEqual([
      { id: "g01", text: demoText("g01"), proposerKind: "human", since: new Date("2026-09-17T15:00:00+08:00").toISOString(), retiredLater: false },
    ]);
    expect(p.pendingGuidelines).toBe(1);
  });

  it("staff 打開 s14：依照的守則照樣看得到，但沒有等確認的提示", async () => {
    const p = (await panel("staff", "s14"))!;
    expect(p.guidelines.map((g) => g.id)).toEqual(["g01"]);
    expect(p.pendingGuidelines).toBe(0);
  });

  it("k10（Linden）：g04 在交件之後收回（之後已收回），g05 是確認時修改的文字與確認日期", async () => {
    const p = (await panel("manager", "k10"))!;
    const g05 = demo.guidelines.find((g) => g.id === "g05")!;
    expect(p.guidelines).toEqual([
      { id: "g04", text: demoText("g04"), proposerKind: "human", since: new Date("2026-09-02T15:00:00+08:00").toISOString(), retiredLater: true },
      { id: "g05", text: g05.decisions[0].revisedText![lang], proposerKind: "employee", since: new Date("2026-10-03T10:00:00+08:00").toISOString(), retiredLater: false },
    ]);
    expect(p.pendingGuidelines).toBe(0);
  });

  it("s01（沒有依照守則）：沒有「這次依照的守則」，只在同一位置留等確認的提示；s14 有標題、自述與提示；staff 都沒有", async () => {
    const render = (data: NonNullable<Awaited<ReturnType<typeof panel>>>) =>
      renderToStaticMarkup(
        createElement(ReviewPanel, { anchor: { current: null }, panel: data, language: lang, saving: false, saveFailed: false, decide: async () => undefined, onOpenEmployee: () => undefined }),
      );
    const s01 = render((await panel("manager", "s01"))!);
    expect(s01).not.toContain(t.followedTitle);
    expect(s01).toContain(t.pendingGuidelinesOpen);
    const s14 = render((await panel("manager", "s14"))!);
    expect(s14).toContain(t.followedTitle);
    expect(s14).toContain(t.followedJudge);
    expect(s14).toContain(fill(t.followedBy, {}, lang).replace("{employee}", "").trim());
    expect(s14).toContain(t.pendingGuidelinesOpen);
    expect(render((await panel("staff", "s01"))!)).not.toContain("crew-review__followed");
  });
});
