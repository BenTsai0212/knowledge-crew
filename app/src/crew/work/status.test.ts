// 工作狀態與需注意的標記（#134）：純函式，以自訂輸入檢查邊界。依 demo 資料的比對在 ui/overview.test.ts。
import { describe, expect, it } from "vitest";
import { attentionFlags, needsAttention, STALL_DAYS, stayDays, statusSince, WORK_STATUSES, workStatus, type StatusInput } from "./status";

const TODAY = "2026-11-20";
// 時刻都在 UTC 中午：任何時區的本地日期都相同
const at = (date: string) => `${date}T12:00:00Z`;
const input = (patch: Partial<StatusInput & { dueAt: string | null }> = {}): StatusInput & { dueAt: string | null } => ({
  assignedAt: at("2026-11-10"),
  latestRound: null,
  latestSubmittedAt: null,
  latestVerdict: null,
  latestDecidedAt: null,
  dueAt: null,
  ...patch,
});
const submitted = (date: string, round = 1) => ({ latestRound: round, latestSubmittedAt: at(date) });

describe("workStatus", () => {
  it("沒有交件＝待交件；最新一輪沒驗收＝等驗收；退回＝修正中；通過＝已完成", () => {
    expect(workStatus(input())).toBe("notSubmitted");
    expect(workStatus(input(submitted("2026-11-11")))).toBe("awaiting");
    expect(workStatus(input({ ...submitted("2026-11-11"), latestVerdict: "returned", latestDecidedAt: at("2026-11-12") }))).toBe("revising");
    expect(workStatus(input({ ...submitted("2026-11-11", 2), latestVerdict: "accepted", latestDecidedAt: at("2026-11-12") }))).toBe("done");
  });

  it("看板的欄位順序是待交件、等驗收、修正中、已完成", () => {
    expect(WORK_STATUSES).toEqual(["notSubmitted", "awaiting", "revising", "done"]);
  });
});

describe("statusSince 與 stayDays", () => {
  it("進入狀態的時間：交辦、交件、驗收", () => {
    expect(statusSince(input())).toBe(at("2026-11-10"));
    expect(statusSince(input(submitted("2026-11-15")))).toBe(at("2026-11-15"));
    expect(statusSince(input({ ...submitted("2026-11-15"), latestVerdict: "returned", latestDecidedAt: at("2026-11-16") }))).toBe(at("2026-11-16"));
  });

  it("停留天數以日期相減；今天才進入是 0，未來的時間不會是負數", () => {
    expect(stayDays(input({ assignedAt: at("2026-11-20") }), TODAY)).toBe(0);
    expect(stayDays(input({ assignedAt: at("2026-11-17") }), TODAY)).toBe(3);
    expect(stayDays(input({ assignedAt: at("2026-11-16") }), TODAY)).toBe(4);
    expect(stayDays(input({ assignedAt: at("2026-11-22") }), TODAY)).toBe(0);
  });
});

describe("attentionFlags", () => {
  it(`停滯：停留超過 ${STALL_DAYS} 天（剛好 ${STALL_DAYS} 天不算）`, () => {
    expect(attentionFlags(input({ assignedAt: at("2026-11-17") }), TODAY).stalled).toBe(false);
    expect(attentionFlags(input({ assignedAt: at("2026-11-16") }), TODAY).stalled).toBe(true);
    expect(attentionFlags(input(submitted("2026-11-16")), TODAY).stalled).toBe(true);
  });

  it("逾期與 3 天內到期沿用 dueStatus()；沒有到期日都不標", () => {
    const recent = { assignedAt: at("2026-11-19") };
    expect(attentionFlags(input({ ...recent, dueAt: "2026-11-19" }), TODAY)).toEqual({ overdue: true, soon: false, stalled: false });
    expect(attentionFlags(input({ ...recent, dueAt: "2026-11-23" }), TODAY)).toEqual({ overdue: false, soon: true, stalled: false });
    expect(attentionFlags(input({ ...recent, dueAt: "2026-11-24" }), TODAY)).toEqual({ overdue: false, soon: false, stalled: false });
    expect(attentionFlags(input(recent), TODAY)).toEqual({ overdue: false, soon: false, stalled: false });
  });

  it("已完成：即使逾期、停留很久也不標", () => {
    const done = input({ ...submitted("2026-10-01"), latestVerdict: "accepted", latestDecidedAt: at("2026-10-02"), dueAt: "2026-10-01" });
    expect(attentionFlags(done, TODAY)).toEqual({ overdue: false, soon: false, stalled: false });
  });

  it("needsAttention：任一個標記成立", () => {
    expect(needsAttention({ overdue: false, soon: false, stalled: false })).toBe(false);
    expect(needsAttention({ overdue: true, soon: false, stalled: false })).toBe(true);
    expect(needsAttention({ overdue: false, soon: true, stalled: false })).toBe(true);
    expect(needsAttention({ overdue: false, soon: false, stalled: true })).toBe(true);
  });
});
