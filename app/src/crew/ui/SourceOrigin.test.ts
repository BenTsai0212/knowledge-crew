// 原文的「這條知識經過的把關」的文字（#147；原本是 #92 PR 3 的一行來源）：
// 第一行「{員工} 整理・{驗收者} 驗收通過（日期）」，第二行以「・」連接、沒有的項目不顯示。
import { describe, expect, it } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import type { FlowbackOrigin } from "../knowledge/origin";
import { originLines } from "./SourceOrigin";

const origin: FlowbackOrigin = {
  assignmentId: "k13", title: "Title", employeeName: "Linden", decidedAt: "2026-11-22T04:00:00.000Z",
  decidedBy: "manager", level: "light", returned: 0, checks: { passed: 3, total: 3 }, guidelines: 1,
};
const roleLabel = (language: string) => clientConfig.access.roles.find((r) => r.id === "manager")!.label[language];

describe("originLines", () => {
  it("每種語言都帶入員工、驗收者的身分名稱與日期，沒有殘留的參數", () => {
    for (const language of clientConfig.client.languages) {
      const { by, facts } = originLines(origin, language);
      expect(by, language).toContain("Linden");
      expect(by, language).toContain(roleLabel(language));
      expect(by, language).toContain("2026");
      expect(`${by}${facts}`, language).not.toMatch(/[{}]/);
    }
  });

  it("第二行：審查層級・第一次就通過・自動檢查・依照守則，依序以分隔符號連接", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      expect(originLines(origin, language).facts, language).toBe(
        [t.originLevelLight, t.originFirstTime, fill(t.originChecks, { passed: 3, total: 3 }, language), fill(t.originGuidelines, { count: 1 }, language)].join(t.originSeparator),
      );
    }
  });

  it("沒有自動檢查、沒有依照守則時不顯示那兩項；退回過時寫退回次數", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      const facts = originLines({ ...origin, level: "item", returned: 2, checks: null, guidelines: 0 }, language).facts;
      expect(facts, language).toBe([t.originLevelItem, fill(t.originReturned, { count: 2 }, language)].join(t.originSeparator));
    }
  });
});
