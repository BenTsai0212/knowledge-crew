// 守則的狀態推算（crew ADR 0007 決定 3、#142）。
import { describe, expect, it } from "vitest";
import { activeAt, canBeGuideline, canDecide, currentText, guidelineStatus, type GuidelineDecision } from "./status";

const d = (decision: GuidelineDecision["decision"], decidedAt: string, revisedText: string | null = null): GuidelineDecision => ({
  decision, decidedAt, revisedText,
});

const CONFIRM = d("confirm", "2026-10-03T10:00:00+08:00");
const REVOKE = d("revoke", "2026-10-20T10:00:00+08:00");

describe("guidelineStatus()", () => {
  it.each([
    ["沒有決定：等確認", [], "pending"],
    ["確認：生效", [CONFIRM], "active"],
    ["不採用", [d("reject", "2026-09-17T10:00:00+08:00")], "rejected"],
    ["確認後收回：已收回", [CONFIRM, REVOKE], "revoked"],
    ["順序以時間為準，不看陣列順序", [REVOKE, CONFIRM], "revoked"],
  ] as const)("%s", (_name, decisions, expected) => {
    expect(guidelineStatus(decisions)).toBe(expected);
  });
});

describe("currentText()", () => {
  it("沒有修改：提出的文字", () => {
    expect(currentText("保養方式依材質分段", [CONFIRM])).toBe("保養方式依材質分段");
    expect(currentText("保養方式依材質分段", [])).toBe("保養方式依材質分段");
  });

  it("修改後確認：以修改後的文字為準，收回後仍是修改後的文字", () => {
    const revised = d("confirm", "2026-10-03T10:00:00+08:00", "保養方式依材質分段，每段開頭寫材質名稱");
    expect(currentText("保養方式依材質分段", [revised])).toBe("保養方式依材質分段，每段開頭寫材質名稱");
    expect(currentText("保養方式依材質分段", [revised, REVOKE])).toBe("保養方式依材質分段，每段開頭寫材質名稱");
  });
});

describe("canDecide()", () => {
  it("等確認：可以確認或不採用，不能收回", () => {
    expect(canDecide([], "confirm")).toBe(true);
    expect(canDecide([], "reject")).toBe(true);
    expect(canDecide([], "revoke")).toBe(false);
  });

  it("生效：只能收回", () => {
    expect(canDecide([CONFIRM], "revoke")).toBe(true);
    expect(canDecide([CONFIRM], "confirm")).toBe(false);
    expect(canDecide([CONFIRM], "reject")).toBe(false);
  });

  it("不採用與已收回：不能再做任何決定", () => {
    for (const decisions of [[d("reject", "2026-09-17T10:00:00+08:00")], [CONFIRM, REVOKE]]) {
      for (const next of ["confirm", "reject", "revoke"] as const) expect(canDecide(decisions, next)).toBe(false);
    }
  });
});

describe("activeAt()", () => {
  it("確認之前不生效，確認的時間點起生效，收回的時間點起不生效", () => {
    const decisions = [CONFIRM, REVOKE];
    expect(activeAt(decisions, "2026-10-03T09:59:59+08:00")).toBe(false);
    expect(activeAt(decisions, "2026-10-03T10:00:00+08:00")).toBe(true);
    expect(activeAt(decisions, "2026-10-19T09:00:00+08:00")).toBe(true);
    expect(activeAt(decisions, "2026-10-20T10:00:00+08:00")).toBe(false);
    expect(activeAt(decisions, "2026-10-21T09:00:00+08:00")).toBe(false);
  });

  it("等確認與不採用：任何時間都不生效", () => {
    expect(activeAt([], "2026-12-01T00:00:00Z")).toBe(false);
    expect(activeAt([d("reject", "2026-09-17T10:00:00+08:00")], "2026-12-01T00:00:00Z")).toBe(false);
  });
});

describe("canBeGuideline()", () => {
  it.each([
    ["做錯了＋意見", "wrong", "以合約為準", true],
    ["不一樣的做法＋意見", "different_approach", "報價請附上有效期限", true],
    ["流程上的小問題", "process", "圖片尺寸不符", false],
    ["沒有意見", "wrong", null, false],
    ["意見只有空白", "different_approach", "  \n", false],
    ["通過（沒有原因）", null, "很好", false],
  ] as const)("%s", (_name, reason, note, expected) => {
    expect(canBeGuideline(reason, note)).toBe(expected);
  });
});
