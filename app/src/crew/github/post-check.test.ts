import { describe, expect, it } from "vitest";
import cases from "../../../../tools/workflow/testdata/post-check-cases.json";
import { BLOCKED_COMMENT_HEADINGS, checkComment, checkIssue, scanLines, startsWithControlHeading } from "./post-check";

// 本檔也在 repo 的掃描範圍內：會命中的範例以片段組成（與共用案例檔相同的佔位寫法）
const expand = (text: string) => text.replaceAll("{AT}", "@").replaceAll("{USERS}", `/${"Users"}`).replaceAll("{HOME}", `/${"home"}`);
const at = (local: string, domain: string) => `${local}@${domain}`;
const users = (name: string) => `/${"Users"}/${name}`;

// 工具的模組沒有型別宣告：以動態匯入讀取，只用到 scanText()
type ToolScan = (text: string, names: string[]) => { line: number; kind: string }[];
const TOOL = new URL("../../../../tools/workflow/check-sensitive.mjs", import.meta.url).href;
const HEADINGS_TOOL = new URL("../../../../tools/workflow/headings.mjs", import.meta.url).href;
const TOOL_KIND: Record<string, string> = { email: "email", 個人路徑: "personalPath", 禁用名稱: "deniedName" };

describe("與 tools/workflow/ 共用的案例", () => {
  it("案例涵蓋三種問題與沒有問題的情況", () => {
    expect(new Set(cases.cases.flatMap((c) => c.expect.map((e) => e.kind)))).toEqual(new Set(["email", "personalPath", "deniedName"]));
    expect(cases.cases.some((c) => c.expect.length === 0)).toBe(true);
  });

  it.each(cases.cases.map((c) => [c.name, c] as const))("%s：結果與案例相同", (_, c) => {
    const text = expand(c.text);
    expect(scanLines(text, c.names)).toEqual(c.expect);
    const r = checkComment(text, c.names);
    expect(r.ok).toBe(c.expect.length === 0);
    expect(r.findings).toEqual(c.expect.map((e) => ({ field: "body", ...e })));
  });

  it("每個案例與 check-sensitive.mjs 的 scanText() 結果相同", async () => {
    const { scanText } = (await import(/* @vite-ignore */ TOOL)) as { scanText: ToolScan };
    for (const c of cases.cases) {
      const text = expand(c.text);
      const tool = scanText(text, c.names).map((f) => ({ line: f.line, kind: TOOL_KIND[f.kind] }));
      expect(scanLines(text, c.names), c.name).toEqual(tool);
    }
  });
});

describe("禁用名稱清單由呼叫的一方傳入", () => {
  it("沒有清單或清單是空的時拒絕，不檢查內容", () => {
    for (const names of [undefined, null, [], ["", "  "]]) {
      const missing = { ok: false, findings: [{ field: "body", line: 0, kind: "deniedNamesMissing" }] };
      expect(checkComment("沒有問題的留言", names)).toEqual(missing);
      expect(checkIssue({ title: "feat: 標題", body: "本文" }, names)).toEqual(missing);
    }
  });

  it("名稱前後的空白不算", () => {
    expect(checkComment("給 Zorblax 的留言", ["  zorblax  "]).findings).toEqual([{ field: "body", line: 1, kind: "deniedName" }]);
  });
});

describe("不回傳命中的文字", () => {
  it("結果只有欄位、行號與種類", () => {
    const r = checkIssue({ title: "feat: Zorblax 的需求", body: `第一行\n${users("alice")} ${at("alice", "mail.co")}` }, ["Zorblax"]);
    expect(r).toEqual({
      ok: false,
      findings: [
        { field: "title", line: 1, kind: "deniedName" },
        { field: "body", line: 2, kind: "email" },
        { field: "body", line: 2, kind: "personalPath" },
      ],
    });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/alice|zorblax/i);
  });
});

describe("留言不得以控制標題開頭（#108 D3）", () => {
  it("控制標題與 headings.mjs 的 decision、changeRequest 一致（兩種流程語言）", async () => {
    const { allHeadings } = (await import(/* @vite-ignore */ HEADINGS_TOOL)) as { allHeadings: (key: string) => string[] };
    expect([...BLOCKED_COMMENT_HEADINGS].sort()).toEqual([...allHeadings("decision"), ...allHeadings("changeRequest")].sort());
    expect(BLOCKED_COMMENT_HEADINGS).toContain("## 決定");
    expect(BLOCKED_COMMENT_HEADINGS).toContain("## 修正要求");
  });

  it.each([
    ["## 決定", 1],
    ["## 決定（補充）\n\n同意", 1],
    // 中文標題與 headings.mjs 一樣以 startsWith 判斷：agent 也會把這則當成決定
    ["## 決定事項的整理", 1],
    ["## 修正要求\n\n- [ ] 改這裡", 1],
    ["\n\n  ## 決定\n同意", 3],
    ["## Decision\n\nok", 1],
    ["## decision (addendum)", 1],
    ["## Change request\n- [ ] x", 1],
  ])("%j 被擋下", (body, line) => {
    const r = checkComment(body, ["Zorblax"]);
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([{ field: "body", line, kind: "controlHeading" }]);
  });

  it.each([
    "一般留言\n\n## 決定 寫在中間不算開頭",
    "### 決定",
    "## Decisions needed",
    "## 計畫（#111）",
    "引用：## 修正要求",
  ])("%j 不擋", (body) => {
    expect(checkComment(body, ["Zorblax"])).toEqual({ ok: true, findings: [] });
  });

  it("startsWithControlHeading 只看開頭", () => {
    expect(startsWithControlHeading("  ## 修正要求")).toBe(true);
    expect(startsWithControlHeading("ok\n## 修正要求")).toBe(false);
  });

  it("控制標題與其他問題一起回報", () => {
    expect(checkComment(`## 決定\n${at("bob", "corp.co")}`, ["Zorblax"]).findings).toEqual([
      { field: "body", line: 1, kind: "controlHeading" },
      { field: "body", line: 2, kind: "email" },
    ]);
  });
});
