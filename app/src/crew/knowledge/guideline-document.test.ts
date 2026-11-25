// 守則的文件（#149）：標題、兩段（守則的文字、來歷）、id 的格式。
import { describe, expect, it } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { workTypeLabel } from "../ui/labels";
import { guidelineDocumentId, guidelineIdOfDocument, reasonLabel, TITLE_TEXT_LENGTH, toGuidelineDocument, type GuidelineDocumentInput } from "./guideline-document";

const input: GuidelineDocumentInput = {
  employeeName: "Rowan", workTypeId: "support", text: "  Answer first  ", proposerKind: "human", returnDate: "2026-09-17",
  reason: "different_approach", confirmerName: "Manager", confirmDate: "2026-09-18", revised: false,
};

describe("toGuidelineDocument", () => {
  it("每種語言：第一段是去掉前後空白的守則文字，第二段帶入員工、工作類型、日期、原因與確認者，沒有殘留的參數", () => {
    for (const language of clientConfig.client.languages) {
      const doc = toGuidelineDocument(input, language);
      expect(doc.passages[0]).toBe("Answer first");
      for (const part of ["Rowan", workTypeLabel("support", language), "2026-09-17", "2026-09-18", "Manager", reasonLabel("different_approach", language)]) {
        expect(doc.passages[1], language).toContain(part);
      }
      expect(doc.title, language).toContain("Answer first");
      expect(`${doc.title}${doc.passages.join("")}`, language).not.toMatch(/[{}]/);
    }
  });

  it("人提的來歷沒有「整理提出」「確認時修改」；員工提、修改後確認時加上", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      const drafted = fill(t.guidelineDocDrafted, { employee: "Rowan" }, language);
      const human = toGuidelineDocument(input, language).passages[1];
      expect(human, language).not.toContain(drafted);
      expect(human, language).not.toContain(t.guidelineDocRevised);
      const employee = toGuidelineDocument({ ...input, proposerKind: "employee", revised: true }, language).passages[1];
      expect(employee, language).toContain(drafted);
      expect(employee, language).toContain(t.guidelineDocRevised);
    }
  });

  it("標題的守則文字超過上限時截斷並加省略號，未超過時完整", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      const long = "字".repeat(TITLE_TEXT_LENGTH + 5);
      const title = toGuidelineDocument({ ...input, text: long }, language).title;
      expect(title, language).toContain(`${"字".repeat(TITLE_TEXT_LENGTH)}${t.guidelineDocEllipsis}`);
      expect(title, language).not.toContain("字".repeat(TITLE_TEXT_LENGTH + 1));
      expect(toGuidelineDocument({ ...input, text: "字".repeat(TITLE_TEXT_LENGTH) }, language).title).not.toContain(t.guidelineDocEllipsis);
    }
  });
});

describe("文件 id", () => {
  it("crew-guideline-<守則 id>，與回流的 crew-<工作 id> 分得開", () => {
    expect(guidelineDocumentId("g01")).toBe("crew-guideline-g01");
    expect(guidelineIdOfDocument("crew-guideline-g01")).toBe("g01");
    expect(guidelineIdOfDocument("crew-k12-w1")).toBeNull();
  });
});
