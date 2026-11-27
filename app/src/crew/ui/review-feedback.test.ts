// 驗收面板的自述／獨立檢查分區與逐條回饋（#168，crew ADR 0008 第 12～16 點）：純函式、readReviewPanel() 讀回的資料與面板的 HTML。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { createReview } from "../db/store";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { crewStrings } from "../i18n";
import { readReviewPanel } from "./review";
import { feedbackInput, feedbackItem, NO_MARKS, storedMarks, toggled } from "./review/feedback";
import { ReviewPanel } from "./review/ReviewPanel";
import { canReviewOf } from "./today";

const lang = clientConfig.client.defaultLanguage;
const t = crewStrings("review", lang);
const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
const panel = async (db: Database, identity: string, id: string) =>
  (await readReviewPanel(db, identity, lang, id, canReviewOf(clientConfig.access, identity)))!;
const render = (p: Awaited<ReturnType<typeof panel>>) =>
  renderToStaticMarkup(createElement(ReviewPanel, { anchor: { current: null }, panel: p, language: lang, saving: false, saveFailed: false, decide: async () => {} }));
const count = (html: string, text: string) => html.split(text).length - 1;

const DB_TIMEOUT = 20_000;

describe("逐條回饋的純函式", () => {
  it("同一對象最多選一個；再選一次已選的結果時取消", () => {
    const a = toggled(new Map<number, "ok" | "problem">(), 1, "ok");
    expect([...a]).toEqual([[1, "ok"]]);
    expect([...toggled(a, 1, "problem")]).toEqual([[1, "problem"]]);
    expect([...toggled(a, 1, "ok")]).toEqual([]);
  });

  it("沒有標記時不傳 feedback；有標記時重點依序號排序", () => {
    expect(feedbackInput(NO_MARKS)).toBeUndefined();
    const marks = { points: new Map([[2, "problem" as const], [1, "ok" as const]]), guidelines: new Map() };
    expect(feedbackInput(marks)).toEqual({ points: [{ ordinal: 1, result: "ok" }, { ordinal: 2, result: "problem" }] });
    expect(feedbackInput({ points: new Map(), guidelines: new Map([["g01", "not_done" as const]]) })).toEqual({ guidelines: [{ guidelineId: "g01", result: "not_done" }] });
  });

  it("組名的 {item} 是文字的前 20 字（以字元計）", () => {
    expect(feedbackItem("  短的  ")).toBe("短的");
    expect(feedbackItem("一二三四五六七八九十一二三四五六七八九十多出來")).toBe("一二三四五六七八九十一二三四五六七八九十");
    expect(feedbackItem("Uncertain entities (model numbers)")).toBe("Uncertain entities (");
  });

  it("已驗收的逐條回饋換成 Marks", () => {
    const m = storedMarks({ points: [{ ordinal: 2, result: "problem" }], guidelines: [{ guidelineId: "g05", result: "done" }] });
    expect([m.points.get(2), m.guidelines.get("g05")]).toEqual(["problem", "done"]);
  });
});

describe("readReviewPanel 與面板（#168）", { timeout: DB_TIMEOUT }, () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("待驗收的 k13（manager）：兩個分區、說明與選填提示；每個重點與守則一組切換按鈕，都沒選", async () => {
    const k13 = await panel(db, "manager", "k13");
    expect(k13.feedback).toBeNull();
    const html = render(k13);
    for (const text of [t.groupSelf, t.groupSelfHint, t.groupIndependent, t.groupIndependentHint, t.feedbackHint]) expect(html).toContain(text);
    // 分區是 h4、卡片標題是 h5（面板標題是 h3，不跳級）
    expect(html).toContain(`<h4 id="crew-review-zone-self">${t.groupSelf}</h4>`);
    expect(html).toContain(`<h5 id="crew-review-points-title">${t.points}</h5>`);
    expect(html).toContain(`<h5 id="crew-review-checks-title">${t.checks}</h5>`);
    expect(html).toContain(`<h4 id="crew-review-zone-independent">${t.groupIndependent}</h4>`);
    expect(html).toContain(`<h5 id="crew-review-followed-title">${t.followedTitle}</h5>`);
    // 員工標出的分區在系統檢查的分區之前，重點在守則之前（#186 起分區標題與檢查卡標題同為「系統檢查」，以 id 比位置）
    expect(html.indexOf('id="crew-review-zone-self"')).toBeLessThan(html.indexOf('id="crew-review-points-title"'));
    expect(html.indexOf('id="crew-review-followed-title"')).toBeLessThan(html.indexOf('id="crew-review-zone-independent"'));
    expect(html.indexOf('id="crew-review-zone-independent"')).toBeLessThan(html.indexOf('id="crew-review-checks-title"'));
    const groups = k13.focus.points.length + k13.guidelines.length;
    expect(groups).toBeGreaterThan(1);
    expect(count(html, 'role="group"')).toBe(groups);
    expect(count(html, `>${t.feedbackPointOk}<`)).toBe(k13.focus.points.length);
    expect(count(html, `>${t.feedbackGuidelineNotDone}<`)).toBe(k13.guidelines.length);
    expect(count(html, 'aria-pressed="true"')).toBe(0);
    expect(html).toContain(`aria-label="${fill(t.feedbackFor, { item: feedbackItem(k13.focus.points[0]) })}"`);
  });

  it("已驗收的 k12：重點 1 沒問題、重點 2 有問題、守則 g05 做到是唯讀標籤，沒有按鈕與選填提示", async () => {
    const k12 = await panel(db, "manager", "k12");
    expect(k12.feedback).toEqual({
      points: [{ ordinal: 1, result: "ok" }, { ordinal: 2, result: "problem" }],
      guidelines: [{ guidelineId: "g05", result: "done" }],
    });
    const html = render(k12);
    expect(html).toContain(t.groupSelf);
    expect(html).not.toContain(t.feedbackHint);
    expect(html).not.toContain('role="group"');
    expect(count(html, `data-result="ok">${t.feedbackPointOk}<`)).toBe(1);
    expect(count(html, `data-result="problem">${t.feedbackPointProblem}<`)).toBe(1);
    expect(count(html, `data-result="done">${t.feedbackGuidelineDone}<`)).toBe(1);
  });

  it("只能看的身分：沒有切換按鈕與選填提示", async () => {
    // 不能驗收（canDecide 為 false）的面板一律沒有按鈕；demo 中看得到 k13 的只能看身分也一樣
    const k13 = await panel(db, "manager", "k13");
    expect(render({ ...k13, canDecide: false })).not.toContain('role="group"');
    for (const { id } of clientConfig.access.roles.filter((r) => !r.canReview)) {
      const p = await readReviewPanel(db, id, lang, "k13", false);
      if (p === null) continue;
      expect(p.canDecide, id).toBe(false);
      expect(render(p), id).not.toContain('role="group"');
      expect(render(p), id).not.toContain(t.feedbackHint);
    }
  });

  it("s12 的第 1 輪（s12-1，退回）：前幾輪列出 g01 沒做到與「這個錯沒有被標成重點」", async () => {
    const s12 = await panel(db, "manager", "s12");
    const first = s12.earlier.find((w) => w.round === 1)!;
    expect(first.review).toMatchObject({ verdict: "returned", reason: "wrong", notInPoints: true });
    expect(first.review!.feedback).toEqual([{ text: expect.stringMatching(/\S/), result: "not_done" }]);
    const html = render(s12);
    expect(html).toContain(t.notInPointsShown);
    expect(html).toContain(`data-result="not_done">${t.feedbackGuidelineNotDone}<`);
  });

  it("manager 對 k13 逐條回饋並退回（做錯了、沒被標成重點）：讀回後是唯讀標籤與 notInPointsShown", async () => {
    const own = await open();
    try {
      const before = await panel(own, "manager", "k13");
      const guideline = before.guidelines[0].id;
      await createReview(own, "manager", {
        workId: before.current.id,
        verdict: "returned",
        reason: "wrong",
        notInPoints: true,
        feedback: { points: [{ ordinal: 1, result: "problem" }], guidelines: [{ guidelineId: guideline, result: "not_done" }] },
      });
      const after = await panel(own, "manager", "k13");
      expect(after.returned).toEqual({ reason: "wrong", notInPoints: true });
      expect(after.feedback).toEqual({ points: [{ ordinal: 1, result: "problem" }], guidelines: [{ guidelineId: guideline, result: "not_done" }] });
      const html = render(after);
      expect(html).toContain(t.reasonWrong);
      expect(html).toContain(t.notInPointsShown);
      expect(html).not.toContain('role="group"');
      expect(html).toContain(`data-result="problem">${t.feedbackPointProblem}<`);
      expect(html).toContain(`data-result="not_done">${t.feedbackGuidelineNotDone}<`);
    } finally {
      await own.close();
    }
  });

  it("沒勾「沒被標成重點」的退回不顯示 notInPointsShown", async () => {
    const own = await open();
    try {
      const before = await panel(own, "manager", "k13");
      await createReview(own, "manager", { workId: before.current.id, verdict: "returned", reason: "wrong" });
      const after = await panel(own, "manager", "k13");
      expect(after.returned).toEqual({ reason: "wrong", notInPoints: false });
      expect(render(after)).not.toContain(t.notInPointsShown);
    } finally {
      await own.close();
    }
  });
});
