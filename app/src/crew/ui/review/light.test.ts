// 驗收面板的少看（#102）：「為什麼是少看」的日期與次數、收起的規則（哪些欄位收、哪些不收）
import { describe, expect, it } from "vitest";
import type { LevelDecision, Review } from "../../trust/types";
import { parseWorkBody } from "../../work/body";
import { keptInLight, lightReason, splitFields } from "./light";

const ok = (id: string, decidedAt: string): Review => ({ id, verdict: "accepted", reason: null, decidedAt });
const wrong = (id: string, decidedAt: string): Review => ({ id, verdict: "returned", reason: "wrong", decidedAt });
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;

describe("lightReason", () => {
  const relax: LevelDecision = { decision: "relax", decidedAt: day(13) };

  it("日期是最新一次同意少看；次數是最近連續沒有做錯的驗收，最多 window 次", () => {
    const reviews = Array.from({ length: 12 }, (_, i) => ok(`r${i}`, day(i + 1)));
    const decisions: LevelDecision[] = [{ decision: "relax", decidedAt: day(2) }, { decision: "revoke", decidedAt: day(3) }, relax];
    expect(lightReason(reviews, decisions, 10)).toEqual({ relaxedAt: day(13), recent: 10 });
  });

  it("做錯了之後的次數才算；輸入不必依時間排序", () => {
    const reviews = [ok("c", day(9)), wrong("b", day(5)), ok("a", day(1)), ok("d", day(8))];
    expect(lightReason(reviews, [relax], 10)).toEqual({ relaxedAt: day(13), recent: 2 });
  });

  it("「其他退回」不影響次數", () => {
    const other: Review = { id: "x", verdict: "returned", reason: "process", decidedAt: day(4) };
    expect(lightReason([ok("a", day(1)), other], [relax], 10)?.recent).toBe(2);
  });

  it("沒有同意少看的紀錄時是 null", () => {
    expect(lightReason([ok("a", day(1))], [], 10)).toBeNull();
    expect(lightReason([ok("a", day(1))], [{ decision: "revoke", decidedAt: day(2) }], 10)).toBeNull();
  });
});

describe("收起的規則", () => {
  const open = String.fromCodePoint(0x3014);
  const close = String.fromCodePoint(0x3015);
  const body = parseWorkBody(
    [
      "@@ kb/e | Entry",
      "@@ kb/e#owner [required] [point 1] | Owner",
      "Ops",
      "@@ kb/e#payment | Payment",
      "Card",
      "@@ kb/e#arrival | Arrival",
      `In ${open}2${close}4 weeks${open}/2${close}`,
      "@@ kb/e#cancel | Cancel",
      "Free",
      "@@ kb/e#date [required] | Date",
      "@@ kb/e#note | Note",
    ].join("\n"),
    2,
  );
  const fields = body.sections.filter((s) => s.key!.includes("#"));
  const keys = (xs: { key: string | null }[]) => xs.map((s) => s.key);

  it("不收：整個欄位是重點、內容中有重點、空白的必填欄位、空白的選填欄位", () => {
    expect(fields.filter(keptInLight).map((s) => s.key)).toEqual(["kb/e#owner", "kb/e#arrival", "kb/e#date", "kb/e#note"]);
  });

  it("收：沒標重點、不是空白的欄位，依原本的順序", () => {
    const { shown, collapsed } = splitFields(fields, true);
    expect(keys(shown)).toEqual(["kb/e#owner", "kb/e#arrival", "kb/e#date", "kb/e#note"]);
    expect(keys(collapsed)).toEqual(["kb/e#payment", "kb/e#cancel"]);
  });

  it("不是少看時全部照樣顯示", () => {
    const { shown, collapsed } = splitFields(fields, false);
    expect(keys(shown)).toEqual(keys(fields));
    expect(collapsed).toEqual([]);
  });
});
