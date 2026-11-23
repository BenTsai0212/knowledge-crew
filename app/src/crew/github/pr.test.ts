// PR 描述 → 要看的重點與交件全文（#112）。測試資料全部虛構。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { BodyView } from "../ui/review/BodyView";
import { deliverableOf } from "../ui/review/conclusion";
import { canMark } from "../ui/review/marked";
import { parseWorkBody } from "../work/body";
import { AFTER_MERGE, BEFORE_MERGE, PR_DESCRIPTION_KEY, TODO_HEADING, parseManualTodos, prToWork } from "./pr";
import type { GitHubPrFile } from "./types";
import template from "../../../../.github/pull_request_template.md?raw";

const ZWSP = "​";

/** 虛構的 PR 描述：人工待辦之外照 PR 範本 */
function pr(todo: string[] | null): string {
  const lines = [
    "<!-- 標題用 feat: 前綴 -->",
    "",
    "## 為什麼",
    "",
    "Closes #7",
    "",
    "## 變更內容",
    "",
    "- 常見問題頁加入關鍵字搜尋。",
    "",
    "## 驗證",
    "",
    "- `npm test`：通過",
  ];
  if (todo !== null) lines.push("", "## 人工待辦", "", "<!-- 沒有就寫「無」。 -->", "", ...todo);
  lines.push("", "## 風險", "", "- [x] 以上皆無");
  return lines.join("\n");
}

/** pr(todo) 中 todo[i] 的行號（從 1 開始） */
const at = (i: number) => pr([]).split("\n").length - 3 + i;

const texts = (description: string) => {
  const r = parseManualTodos(description);
  return r.ok ? r.points.map((p) => p.text) : r;
};

describe("PR 範本", () => {
  it("程式中以碼位產生的標題與小標，和 PR 範本的寫法相同", () => {
    expect(TODO_HEADING).toBe("人工待辦");
    expect(BEFORE_MERGE).toBe("合併前");
    expect(AFTER_MERGE).toBe("合併後");
    expect(template).toContain(`## ${TODO_HEADING}\n`);
    expect(template).toContain(`\n${BEFORE_MERGE}：\n`);
    expect(template).toContain(`\n${AFTER_MERGE}：\n`);
  });

  it("沒填的範本（只有空的核取方塊）是沒有重點", () => {
    expect(parseManualTodos(template)).toEqual({ ok: true, points: [] });
  });
});

describe("人工待辦 → 要看的重點", () => {
  it("有合併前與合併後：每個核取方塊一個重點，依順序，小標寫在前面", () => {
    const r = parseManualTodos(pr(["合併前：", "", "- [ ] 確認示範頁的搜尋框位置", "", "合併後：", "", "- [ ] 在線上 demo 試搜尋「保溫瓶」", "- [ ] 通知客服搜尋已上線"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points.map((p) => p.text)).toEqual(["合併前：確認示範頁的搜尋框位置", "合併後：在線上 demo 試搜尋「保溫瓶」", "合併後：通知客服搜尋已上線"]);
    expect(r.points.map((p) => p.phase)).toEqual(["before", "after", "after"]);
    expect(r.points.map((p) => p.checked)).toEqual([false, false, false]);
    expect(r.points.map((p) => p.line)).toEqual([at(2), at(6), at(7)]);
  });

  it("只有合併前，或只有合併後（另一個是空的範本）", () => {
    expect(texts(pr(["合併前：", "", "- [ ] 看手機版的排版"]))).toEqual(["合併前：看手機版的排版"]);
    expect(texts(pr(["合併前：", "", "- [ ]", "", "合併後：", "", "- [ ] 更新說明文件的截圖"]))).toEqual(["合併後：更新說明文件的截圖"]);
    expect(texts(pr(["合併後：無", "合併前：", "- [ ] 看手機版的排版"]))).toEqual(["合併前：看手機版的排版"]);
  });

  it("沒有小標的核取方塊：重點文字不加前綴", () => {
    const r = parseManualTodos(pr(["- [ ] 看錯誤訊息的語氣"]));
    expect(r).toEqual({ ok: true, points: [expect.objectContaining({ text: "看錯誤訊息的語氣", phase: null })] });
  });

  it("寫「無」是沒有重點", () => {
    for (const none of [["無"], ["無。"], ["- 無"], ["合併前：無", "合併後：無"], ["合併前：", "", "- 無", "", "合併後：", "", "無"]]) {
      expect(parseManualTodos(pr(none)), none.join("|")).toEqual({ ok: true, points: [] });
    }
  });

  it("空白是沒有重點（區塊內只有範本的說明，或緊接下一個標題）", () => {
    expect(parseManualTodos(pr([]))).toEqual({ ok: true, points: [] });
    expect(parseManualTodos("## 人工待辦\n## 風險\n- [x] 以上皆無")).toEqual({ ok: true, points: [] });
    expect(parseManualTodos("## 為什麼\n\nRefs #3\n\n## 人工待辦\n\n")).toEqual({ ok: true, points: [] });
  });

  it("核取方塊已勾選或未勾選都是重點，勾選狀態另外記下", () => {
    const r = parseManualTodos(pr(["合併前：", "- [x] 已確認文案", "- [X] 已看過截圖", "- [ ] 等設計確認顏色"]));
    expect(r.ok && r.points.map((p) => [p.text, p.checked])).toEqual([
      ["合併前：已確認文案", true],
      ["合併前：已看過截圖", true],
      ["合併前：等設計確認顏色", false],
    ]);
  });

  it("核取方塊下縮排的下一行接在同一個重點後面；CRLF 換行也讀得到", () => {
    expect(texts(pr(["- [ ] 確認匯出的欄位", "  與會計對過一次"]))).toEqual(["確認匯出的欄位 與會計對過一次"]);
    expect(texts(pr(["合併後：", "- [ ] 通知客服"]).replace(/\n/g, "\r\n"))).toEqual(["合併後：通知客服"]);
  });

  it("缺少區塊：讀不到（程式碼區塊與 HTML 註解中的標題不算）", () => {
    expect(parseManualTodos(pr(null))).toEqual({ ok: false, error: "missing-section" });
    expect(parseManualTodos("## 為什麼\n\n```md\n## 人工待辦\n- [ ] 範例\n```\n")).toEqual({ ok: false, error: "missing-section" });
    expect(parseManualTodos("<!--\n## 人工待辦\n-->\n## 風險")).toEqual({ ok: false, error: "missing-section" });
    expect(parseManualTodos("### 人工待辦\n- [ ] 三級標題不是範本的區塊")).toEqual({ ok: false, error: "missing-section" });
    expect(parseManualTodos("")).toEqual({ ok: false, error: "missing-section" });
  });

  it("格式不符：讀不到，不猜，附上行號", () => {
    expect(parseManualTodos(pr(["合併前要先確認搜尋框的位置。"]))).toEqual({ ok: false, error: "invalid-line", line: at(0) });
    expect(parseManualTodos(pr(["- 確認搜尋框的位置"]))).toEqual({ ok: false, error: "invalid-line", line: at(0) });
    expect(parseManualTodos(pr(["合併前：確認搜尋框"]))).toEqual({ ok: false, error: "invalid-line", line: at(0) });
    expect(parseManualTodos(pr(["- [ ] 確認搜尋框", "", "```", "npm run build", "```"]))).toEqual({ ok: false, error: "invalid-line", line: at(2) });
    expect(parseManualTodos(pr(["### 合併前", "- [ ] 確認搜尋框"]))).toEqual({ ok: false, error: "invalid-line", line: at(0) });
  });

  it("同一個小標下同時有「無」與核取方塊、或區塊出現兩次：格式不符", () => {
    expect(parseManualTodos(pr(["合併前：", "無", "- [ ] 確認搜尋框"]))).toEqual({ ok: false, error: "invalid-line", line: at(1) });
    expect(parseManualTodos("## 人工待辦\n無\n## 人工待辦\n- [ ] 確認")).toEqual({ ok: false, error: "duplicate-section", line: 3 });
  });

  it("讀不到與沒有重點可以分開判斷", () => {
    const none = parseManualTodos(pr(["無"]));
    const unreadable = parseManualTodos(pr(["之後再說"]));
    const missing = parseManualTodos(pr(null));
    expect(none.ok && none.points.length === 0).toBe(true);
    expect(unreadable.ok).toBe(false);
    expect(missing.ok).toBe(false);
  });
});

const FILES: GitHubPrFile[] = [
  { filename: "src/faq/FaqSearch.tsx", status: "added", additions: 48, deletions: 0 },
  { filename: "src/faq/FaqPage.tsx", status: "modified", additions: 6, deletions: 2 },
  { filename: "src/faq/legacy-search.ts", status: "removed", additions: 0, deletions: 31 },
  { filename: "src/faq/normalize.ts", status: "renamed", previous_filename: "src/faq/text.ts" },
];

describe("PR 描述 → 交件全文", () => {
  const description = pr(["合併前：", "", "- [ ] 確認示範頁的搜尋框位置", "", "合併後：", "", "- [x] 通知客服搜尋已上線"]);

  it("檔案依序成為區塊（新增／修改），最後是 pr/description；變更是每個檔案的增減行數", () => {
    const work = prToWork(description, FILES);
    const parsed = parseWorkBody(work.body, work.points.length);
    expect(parsed.structured).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => [s.key, s.attrs.change])).toEqual([
      ["src/faq/FaqSearch.tsx", "added"],
      ["src/faq/FaqPage.tsx", "modified"],
      ["src/faq/legacy-search.ts", null],
      ["src/faq/normalize.ts", "modified"],
      [PR_DESCRIPTION_KEY, null],
    ]);
    expect(work.changes).toEqual([
      { path: "src/faq/FaqSearch.tsx", summary: "+48 -0" },
      { path: "src/faq/FaqPage.tsx", summary: "+6 -2" },
      { path: "src/faq/legacy-search.ts", summary: "+0 -31" },
      { path: "src/faq/normalize.ts", summary: "" },
    ]);
    expect(work.points).toEqual(["合併前：確認示範頁的搜尋框位置", "合併後：通知客服搜尋已上線"]);
    expect(work.omittedFiles).toEqual([]);
  });

  it("pr/description 是其他區塊（為什麼、變更內容、驗證、風險），去掉讀得到的人工待辦與 HTML 註解", () => {
    const work = prToWork(description, FILES);
    const text = parseWorkBody(work.body, work.points.length).sections.at(-1)!.text;
    expect(text.startsWith("## 為什麼\n\nCloses #7")).toBe(true);
    for (const kept of ["## 變更內容", "- 常見問題頁加入關鍵字搜尋。", "## 驗證", "## 風險", "- [x] 以上皆無"]) expect(text).toContain(kept);
    for (const dropped of ["## 人工待辦", "確認示範頁", "<!--", "標題用"]) expect(text).not.toContain(dropped);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("讀不到人工待辦時沒有重點，人工待辦的原文留在 pr/description", () => {
    const work = prToWork(pr(["之後再說"]), FILES);
    expect(work.manualTodos).toMatchObject({ ok: false, error: "invalid-line" });
    expect(work.points).toEqual([]);
    expect(parseWorkBody(work.body, 0).sections.at(-1)!.text).toContain("## 人工待辦\n\n之後再說");
    expect(prToWork(pr(null), FILES).manualTodos).toEqual({ ok: false, error: "missing-section" });
  });

  it("PR 描述中像標頭行或重點標記的寫法不會被當成格式", () => {
    const tricky = ["## 為什麼", "", "```diff", "@@ -1,3 +1,4 @@", "@@", "```", "以〔1〕與〔/1〕標出重點", "", "## 人工待辦", "", "無"].join("\n");
    const work = prToWork(tricky, FILES.slice(0, 1));
    const parsed = parseWorkBody(work.body, 1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.map((s) => s.key)).toEqual(["src/faq/FaqSearch.tsx", PR_DESCRIPTION_KEY]);
    const text = parsed.sections[1].text;
    expect(parsed.sections[1].marks).toEqual([]);
    expect(text.replaceAll(ZWSP, "")).toBe("## 為什麼\n\n```diff\n@@ -1,3 +1,4 @@\n@@\n```\n以〔1〕與〔/1〕標出重點");
  });

  it("路徑不能當區塊的鍵的檔案不寫進全文，另外列出；重複的檔案只算一次", () => {
    const work = prToWork("## 人工待辦\n無", [
      { filename: "docs/release notes.md", status: "modified" },
      { filename: PR_DESCRIPTION_KEY, status: "added" },
      { filename: "src/a.ts", status: "modified" },
      { filename: "src/a.ts", status: "modified" },
    ]);
    expect(work.omittedFiles).toEqual(["docs/release notes.md", PR_DESCRIPTION_KEY]);
    expect(parseWorkBody(work.body, 0).sections.map((s) => s.key)).toEqual(["src/a.ts", PR_DESCRIPTION_KEY]);
    expect(work.changes.map((c) => c.path)).toEqual(["src/a.ts"]);
  });

  it("驗收面板的程式修改交件可以呈現：檔案清單、新增／修改、收起的 PR 描述與重點", () => {
    const language = clientConfig.client.defaultLanguage;
    const t = crewStrings("review", language);
    const work = prToWork(description, FILES);
    const body = parseWorkBody(work.body, work.points.length);
    expect(canMark(body)).toBe(true);
    const out = renderToStaticMarkup(
      createElement(BodyView, {
        name: "PR",
        body,
        raw: work.body,
        changes: { mode: "items", items: work.changes },
        changeItems: work.changes,
        language,
        deliverable: deliverableOf("dev"),
        reference: "example-org/company-site#7・PR #8",
      }),
    );
    expect(out).toContain('data-deliverable="code"');
    expect(out).toContain(`aria-label="${t.codeFiles}"`);
    for (const f of FILES) expect(out).toContain(`<span class="crew-review__ref">${f.filename}</span>`);
    expect(out).toContain(`data-change="added">${t.fileAdded}</span>`);
    expect(out).toContain(`data-change="modified">${t.fileModified}</span>`);
    expect(out).toContain(`<details class="crew-review__details crew-review__pr"><summary>${t.prDescription}</summary>`);
    expect(out).toContain("常見問題頁加入關鍵字搜尋。");
  });
});
