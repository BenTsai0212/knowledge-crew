import { describe, expect, it } from "vitest";
import { demoTextIndex } from "../demo/texts";
import type { DemoFile } from "../demo/types";
import { assignmentRef, sourceLabel, workRef } from "./refs";

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

describe("sourceLabel（#60 的 `## 決定` 2）", () => {
  const demo = {
    sources: [
      { id: "inbox", kind: "mailbox", name: "Support inbox", label: { "zh-TW": "客服信箱", en: "Support inbox" }, project: "bluewing" },
      { id: "site", kind: "repo", name: "example-org/site", project: "longpier" },
    ],
    employees: [],
    assignments: [],
  } as unknown as DemoFile;
  const index = demoTextIndex(demo);

  it("有顯示名稱時用目前語言的顯示名稱", () => {
    expect(sourceLabel("inbox", "Support inbox", "zh-TW", index)).toBe("客服信箱");
    expect(sourceLabel("inbox", "Support inbox", "en", index)).toBe("Support inbox");
  });

  it("沒有顯示名稱（repo 類省略、人新增的來源、沒有的語言）時用資料庫的名稱", () => {
    expect(sourceLabel("site", "example-org/site", "zh-TW", index)).toBe("example-org/site");
    expect(sourceLabel("new-source", "Returns inbox", "zh-TW", index)).toBe("Returns inbox");
    expect(sourceLabel("inbox", "Support inbox", "ja", index)).toBe("Support inbox");
  });

  it("交辦的參照用顯示名稱組出", () => {
    const sourceName = sourceLabel("inbox", "Support inbox", "zh-TW", index);
    expect(assignmentRef({ sourceKind: "mailbox", sourceName, externalRef: "1041" }, "zh-TW")).toBe("客服信箱 1041");
  });
});
