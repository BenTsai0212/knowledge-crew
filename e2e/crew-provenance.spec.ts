// 驗收面板的「這次依照的守則」與原文面板的「這條知識經過的把關」（#147，crew ADR 0007 決定 5、8）。1280 與 390 各跑一次。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import type { DemoFile } from "../app/src/crew/demo/types";
import { openApp, switchIdentity } from "./support/app";
import { access, language, readClientJson } from "./support/client";
import { assignmentTitle, crewFill, crewSections, ct, employeeName, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const guidelines = hasCrewDemo ? readClientJson<DemoFile>("crew/demo.json").guidelines : [];
const guidelineText = (id: string) => guidelines.find((g) => g.id === id)!.text[language];
const managerLabel = access.roles.find((r) => r.id === "manager")?.label[language] ?? "manager";
// 文字中 {employee} 之外的部分（員工名字前有 AI 標記，不能整句比對）
const around = (template: string, values: Record<string, string | number> = {}) =>
  crewFill(template, { ...values, employee: "\u0000" }).split("\u0000").map((x) => x.trim()).filter((x) => x !== "");

async function openWork(page: Page, id: string): Promise<ReturnType<typeof reviewPanel>> {
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
  const title = assignmentTitle(id);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  return panel;
}

for (const width of [1280, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test.beforeEach(async ({ page }) => {
      await openApp(page);
      await switchIdentity(page, "manager");
    });

    test("主管打開 Rowan 的 s14：這次依照的守則（Rowan 自述）與等確認的提示，點了到員工頁", async ({ page }) => {
      const panel = await openWork(page, "s14");
      const followed = panel.getByRole("region", { name: ct.review.followedTitle, exact: true });
      await expect(followed).toBeVisible();
      const badge = followed.locator(".crew-review__self-reported");
      await expect(badge).toContainText(employeeName("rowan"));
      for (const part of around(ct.review.followedBy)) await expect(badge).toContainText(part);
      await expect(followed.getByText(ct.review.followedJudge, { exact: true })).toBeVisible();
      await expect(followed.getByRole("listitem").filter({ hasText: guidelineText("g01") })).toContainText(around(ct.review.followedSavedOnReturn, { date: "\u0000" })[0] ?? "");

      const pending = followed.getByRole("note");
      await expect(pending).toContainText(employeeName("rowan"));
      if (!ct.review.pendingGuidelines.includes(", plural")) {
        for (const part of around(ct.review.pendingGuidelines, { count: 1 })) await expect(pending).toContainText(part);
      }
      await pending.getByRole("button", { name: ct.review.pendingGuidelinesOpen, exact: true }).click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionEmployees, exact: true })).toHaveAttribute("aria-current", "page");
      const rowan = page.getByRole("region", { name: employeeName("rowan") }).filter({ has: page.locator(".crew-employees__top") });
      await expect(rowan).toBeInViewport();
    });

    test("驗收 Linden 的 k13 → 打開原文：這條知識經過的把關的兩行與「看這次驗收」", async ({ page }) => {
      const panel = await openWork(page, "k13");
      await panel.getByRole("button", { name: ct.review.accept, exact: true }).click();
      await panel.getByRole("button", { name: ct.review.knowledgeOpen, exact: true }).click();

      const origin = page.getByRole("region", { name: ct.knowledge.originTitle, exact: true });
      await expect(origin).toBeVisible();
      const [by, facts] = [origin.locator("p").nth(0), origin.locator("p").nth(1)];
      await expect(by).toContainText(employeeName("linden"));
      await expect(by).toContainText(managerLabel);
      // k13 是看重點時通過的（10/13 同意看重點之後沒有做錯），第一次就通過
      await expect(facts).toContainText(ct.knowledge.originLevelLight);
      await expect(facts).toContainText(ct.knowledge.originFirstTime);

      await origin.getByRole("button", { name: ct.knowledge.originOpen, exact: true }).click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(reviewPanel(page, assignmentTitle("k13"))).toBeVisible();
      await expect(origin).toHaveCount(0);
    });
  });
}
