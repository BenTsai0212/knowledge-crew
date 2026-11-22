// 原文的接入點的文字（#92 PR 3）：「來自 AI 員工 ○○・驗收「○○」（日期）」
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { originText } from "./SourceOrigin";

const origin = { assignmentId: "k13", title: "Title", employeeName: "Linden", decidedAt: "2026-11-22T04:00:00.000Z" };

describe("originText", () => {
  it("每種語言都帶入員工、交辦標題與日期，沒有殘留的參數", () => {
    for (const language of clientConfig.client.languages) {
      const text = originText(origin, language);
      expect(text, language).toContain("Linden");
      expect(text, language).toContain("Title");
      expect(text, language).toContain("2026");
      expect(text, language).not.toMatch(/[{}]/);
    }
  });
});
