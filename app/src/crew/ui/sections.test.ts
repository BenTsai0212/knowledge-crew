// crew 頁的子頁與舊位置的對應（#191，ADR 0009 第二節）：四個子頁的順序、預設位置，以及 #191 之前的六個 id 對應到哪裡。
import { describe, expect, it } from "vitest";
import { CREW_SECTIONS, DEFAULT_CREW_SECTION, resolveCrewTarget } from "./sections";

describe("CREW_SECTIONS", () => {
  it("四個子頁：工作、員工、交辦、紀錄（照 13-works.html 的分頁順序），預設是工作", () => {
    expect(CREW_SECTIONS.map((s) => s.id)).toEqual(["works", "employees", "assignments", "records"]);
    expect(CREW_SECTIONS.map((s) => s.label)).toEqual(["sectionWorks", "sectionEmployees", "sectionAssignments", "sectionRecords"]);
    expect(DEFAULT_CREW_SECTION).toBe("works");
  });
});

describe("resolveCrewTarget", () => {
  it("#191 之前的六個 id 都對應到新位置", () => {
    expect(resolveCrewTarget({ section: "overview" })).toEqual({ section: "works", view: "board" });
    expect(resolveCrewTarget({ section: "employees" })).toEqual({ section: "employees" });
    expect(resolveCrewTarget({ section: "assignments" })).toEqual({ section: "assignments" });
    expect(resolveCrewTarget({ section: "works" })).toEqual({ section: "works" });
    expect(resolveCrewTarget({ section: "trust" })).toEqual({ section: "employees" });
    expect(resolveCrewTarget({ section: "ledger" })).toEqual({ section: "records" });
  });

  it("其他欄位照舊帶過去：員工、選取的交辦、紀錄的篩選", () => {
    expect(resolveCrewTarget({ section: "trust", employeeId: "e1" })).toEqual({ section: "employees", employeeId: "e1" });
    expect(resolveCrewTarget({ section: "ledger", ledgerFilter: { employeeId: "e1", event: "returned" } })).toEqual({
      section: "records",
      ledgerFilter: { employeeId: "e1", event: "returned" },
    });
    expect(resolveCrewTarget({ section: "works", assignmentId: "k01" })).toEqual({ section: "works", assignmentId: "k01" });
    expect(resolveCrewTarget({ section: "records", view: "stats" })).toEqual({ section: "records", view: "stats" });
  });

  it("不認得的 id 回到預設位置，不出錯", () => {
    expect(resolveCrewTarget({ section: "nope" })).toEqual({ section: "works" });
    expect(resolveCrewTarget({ section: "toString" })).toEqual({ section: "works" });
    expect(resolveCrewTarget({ section: "" })).toEqual({ section: "works" });
  });
});
