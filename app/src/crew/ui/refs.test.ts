import { describe, expect, it } from "vitest";
import { assignmentRef, workRef } from "./refs";

describe("assignmentRef（#57）", () => {
  it("repo 類照舊是 <repo>#<Issue>", () => {
    expect(assignmentRef({ sourceKind: "repo", sourceName: "example-org/lantern-notes", externalRef: "116" }, "zh-TW")).toBe("example-org/lantern-notes#116");
    expect(assignmentRef({ sourceKind: "repo", sourceName: "example-org/lantern-notes", externalRef: "116" }, "en")).toBe("example-org/lantern-notes#116");
  });

  it("其他類型是來源名稱與外部編號", () => {
    expect(assignmentRef({ sourceKind: "mailbox", sourceName: "support@example.com", externalRef: "T-42" }, "zh-TW")).toBe("support@example.com T-42");
    expect(assignmentRef({ sourceKind: "knowledge_base", sourceName: "Help center", externalRef: "kb-7" }, "en")).toBe("Help center kb-7");
  });

  it("沒有外部編號時只顯示來源名稱（任何類型）", () => {
    expect(assignmentRef({ sourceKind: "social", sourceName: "@example", externalRef: null }, "zh-TW")).toBe("@example");
    expect(assignmentRef({ sourceKind: "repo", sourceName: "example-org/lantern-notes", externalRef: null }, "en")).toBe("example-org/lantern-notes");
  });
});

describe("workRef（#57）", () => {
  it("repo 類照舊是 PR #<編號>", () => {
    expect(workRef("repo", "218", "zh-TW")).toBe("PR #218");
    expect(workRef("repo", "218", "en")).toBe("PR #218");
  });

  it("其他類型只有編號", () => {
    expect(workRef("mailbox", "draft-3", "zh-TW")).toBe("draft-3");
  });

  it("沒有編號時是 null", () => {
    expect(workRef("repo", null, "zh-TW")).toBeNull();
    expect(workRef("social", null, "en")).toBeNull();
  });
});
