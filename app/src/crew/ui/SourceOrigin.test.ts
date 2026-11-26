// 原文的「這條知識經過的把關」與「這條守則的來歷」（#149）的文字（#147；原本是 #92 PR 3 的一行來源）：
// 第一行「{員工} 整理・{驗收者} 驗收通過（日期）」，第二行以「・」連接、沒有的項目不顯示。
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { crewStrings } from "../i18n";
import { reasonLabel } from "../knowledge/guideline-document";
import type { FlowbackOrigin, GuidelineOrigin } from "../knowledge/origin";
import { workTypeLabel } from "./labels";
import { guidelineLines, originLines } from "./SourceOrigin";
import { shortDate } from "./trust";

// #151：員工名字是 EmployeeName（AI 標記），日期是 shortDate 的 MM/DD
const html = (node: ReactNode) => renderToStaticMarkup(createElement("div", null, node));
const aiName = (name: string) => new RegExp(`<span class="crew-employee-name"><span class="crew-ai-mark">.*?</span>${name}</span>`);
/** 畫面上看得到的文字：AI 標記的螢幕閱讀器文字換回 {employee} 前的名字，HTML 實體還原 */
const visible = (node: ReactNode) =>
  html(node)
    .replace(/<span class="crew-ai-mark">.*?<\/span><\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

const origin: FlowbackOrigin = {
  assignmentId: "k13", title: "Title", employeeName: "Linden", decidedAt: "2026-11-22T04:00:00.000Z",
  decidedBy: "manager", level: "light", returned: 0, checks: { passed: 3, total: 3 }, guidelines: 1, correctedAt: null,
};
const roleLabel = (language: string) => clientConfig.access.roles.find((r) => r.id === "manager")!.label[language];

describe("originLines", () => {
  it("每種語言都帶入員工、驗收者的身分名稱與日期，沒有殘留的參數", () => {
    for (const language of clientConfig.client.languages) {
      const { by, facts } = originLines(origin, language);
      expect(html(by), language).toMatch(aiName("Linden"));
      expect(visible(by), language).toContain(roleLabel(language));
      expect(visible(by), language).toContain(shortDate(origin.decidedAt, language));
      expect(visible(by), language).not.toContain("2026");
      expect(`${visible(by)}${facts}`, language).not.toMatch(/[{}]/);
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

  it("事後更正（#164）：有更正時多一行「通過後發現有錯（MM/DD）」，沒有時是 null", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      expect(originLines(origin, language).corrected, language).toBeNull();
      const correctedAt = "2026-11-24T08:00:00.000Z";
      expect(originLines({ ...origin, correctedAt }, language).corrected, language).toBe(fill(t.originCorrected, { date: shortDate(correctedAt, language) }));
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

const guideline: GuidelineOrigin = {
  guidelineId: "g01", employeeId: "rowan", employeeName: "Rowan", workTypeId: "support", text: "Answer first", proposerKind: "human",
  assignmentId: "s05", returnedAt: "2026-09-17T07:00:00.000Z", reason: "different_approach", confirmedBy: "manager",
  confirmedAt: "2026-09-18T07:00:00.000Z", revised: false, revokedAt: null, followed: 3,
};

describe("guidelineLines", () => {
  it("第一行：員工、工作類型、確認者的身分名稱與日期；修改後確認時加註", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      const by = visible(guidelineLines(guideline, language).by);
      expect(html(guidelineLines(guideline, language).by), language).toMatch(aiName("Rowan"));
      for (const part of ["Rowan", workTypeLabel("support", language), roleLabel(language), shortDate(guideline.confirmedAt, language)]) expect(by, language).toContain(part);
      expect(by, language).not.toContain(t.guidelineRevised);
      expect(visible(guidelineLines({ ...guideline, revised: true }, language).by).endsWith(t.guidelineRevised), language).toBe(true);
    }
  });

  it("第二行：來自哪一次退回（原因）；人提是退回時記下，員工提是員工整理提出", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      const human = visible(guidelineLines(guideline, language).from);
      expect(human, language).toContain(reasonLabel("different_approach", language));
      const date = shortDate(guideline.returnedAt, language);
      expect(human, language).toBe(fill(t.guidelineFromHuman, { date, reason: reasonLabel("different_approach", language) }, language));
      const employeeNode = guidelineLines({ ...guideline, proposerKind: "employee" }, language).from;
      expect(html(employeeNode), language).toMatch(aiName("Rowan"));
      const employee = visible(employeeNode);
      expect(employee, language).toContain("Rowan");
      expect(employee, language).not.toBe(human);
      expect(`${human}${employee}`, language).not.toMatch(/[{}]/);
    }
  });

  it("第三行：生效中寫之後依照的次數；已收回寫收回日期與不再依照", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("knowledge", language);
      expect(guidelineLines(guideline, language).status, language).toBe(fill(t.guidelineActive, { count: 3 }, language));
      const revoked = guidelineLines({ ...guideline, revokedAt: "2026-10-20T02:00:00.000Z" }, language).status;
      expect(revoked, language).toContain(shortDate("2026-10-20T02:00:00.000Z", language));
      expect(revoked, language).not.toBe(fill(t.guidelineActive, { count: 3 }, language));
      expect(revoked, language).not.toMatch(/[{}]/);
    }
  });
});
