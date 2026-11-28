// 「沒被標成重點」與事後更正的統計（#168 PR 2，crew ADR 0008 第 14、15 點）：員工頁守則的「被標沒做到 N 次」、
// 信任頁的 missSummary、報表的「錯在沒標成重點的地方」欄，以及由事後更正觸發的層級變化文字。
// k13 對守則選「沒做到」後退回（做錯了、勾「沒被標成重點」）→ 員工頁、員工頁的審查方式與紀錄的統計各加 1；k12 事後更正 → 報表的層級變化。
// 桌機 1280 與手機 390 各跑一次，截圖附在測試報告（`miss-*.png`）。只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { DemoFile } from "../app/src/crew/demo/types";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { assignmentTitle, crewFill, ct, employeeName, gotoCrewSection, gotoRecordsStats, hasCrewDemo, openCrew, reviewPanel, trustRow } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const guidelines = hasCrewDemo ? readClientJson<DemoFile>("crew/demo.json").guidelines : [];
const guidelineText = (id: string) => {
  const g = guidelines.find((x) => x.id === id)!;
  return g.decisions.find((d) => d.revisedText)?.revisedText?.[language] ?? g.text[language];
};

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const report = (page: Page) => page.getByRole("table", { name: ct.trust.reportLabel });
const reportRow = (page: Page, employee: string, workType: string) =>
  report(page).locator(`tbody tr[data-employee="${employee}"][data-work-type="${workType}"]`);
// 欄的順序：驗收次數、第一次就通過、三種退回、抽查、錯在沒標成重點的地方、層級、層級變化
const notInPointsCell = (page: Page, employee: string, workType: string) => reportRow(page, employee, workType).getByRole("cell").nth(6);
const missSummary = (corrections: number, notInPoints: number) => crewFill(ct.trust.missSummary, { corrections, notInPoints });
// 「被標沒做到 N 次」：en 有單複數，只比對數字
const notDoneText = (count: number): string | RegExp =>
  ct.employees.guidelineNotDone.includes(", plural") ? new RegExp(`\\b${count}\\b`) : crewFill(ct.employees.guidelineNotDone, { count });
const employeeCard = (page: Page, id: string) => page.getByRole("region", { name: employeeName(id) }).filter({ has: page.locator(".crew-employees__top") });
const guidelineItem = (page: Page, employee: string, id: string) =>
  employeeCard(page, employee).locator(".crew-employees__guidelines").getByRole("listitem").filter({ hasText: guidelineText(id) });

async function shot(page: Page, testInfo: TestInfo, name: string, target?: Locator): Promise<void> {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: true });
  await testInfo.attach(`miss-${name}-${page.viewportSize()!.width}px.png`, { body, contentType: "image/png" });
}

async function openWork(page: Page, id: string): Promise<Locator> {
  await gotoCrewSection(page, ct.common.sectionWorks);
  const title = assignmentTitle(id);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
});

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("虛構資料：員工頁 Rowan 的 g01 被標沒做到 1 次；員工頁的審查方式與紀錄的統計的統計", async ({ page }, testInfo) => {
      await gotoCrewSection(page, ct.common.sectionEmployees);
      const g01 = guidelineItem(page, "rowan", "g01");
      await expect(g01.locator(".crew-employees__guideline-not-done")).toHaveText(notDoneText(1));
      // 被標過沒做到的才列出
      await expect(guidelineItem(page, "linden", "g05").locator(".crew-employees__guideline-not-done")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "employee-g01", g01);

      // #191：審查方式的列在「員工」的員工卡內，報表在「紀錄」的「看統計」
      const rowan = trustRow(page, "rowan", "support");
      await expect(rowan.locator(".crew-trust__miss")).toHaveText(missSummary(0, 1));
      // 放在抽查的說明下方
      expect((await rowan.locator(".crew-trust__spot").boundingBox())!.y).toBeLessThan((await rowan.locator(".crew-trust__miss").boundingBox())!.y);
      await expect(trustRow(page, "linden", "knowledge").locator(".crew-trust__miss")).toHaveText(missSummary(1, 1));
      await expect(trustRow(page, "juniper", "dev").locator(".crew-trust__miss")).toHaveCount(0);
      await expect(trustRow(page, "sorrel", "content").locator(".crew-trust__miss")).toHaveCount(0);
      await shot(page, testInfo, "trust-rowan", rowan);

      await gotoRecordsStats(page);
      await expect(report(page).getByRole("columnheader", { name: ct.trust.reportColumnNotInPoints, exact: true })).toHaveAttribute("title", ct.trust.reportColumnNotInPoints);
      for (const [employee, workType, count] of [["rowan", "support", "1"], ["linden", "knowledge", "1"], ["juniper", "dev", "0"], ["sorrel", "content", "0"]]) {
        const cell = notInPointsCell(page, employee, workType);
        await expect(cell).toHaveText(count);
        await expect(cell).toHaveAttribute("data-label", ct.trust.reportColumnNotInPoints);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "report", report(page));
    });

    test("k13：守則選「沒做到」後退回（做錯了、沒被標成重點）→ 員工頁、員工頁的審查方式與紀錄的統計各加 1", async ({ page }) => {
      const panel = await openWork(page, "k13");
      // #195：守則列另有「?」（details 的 role 也是 group），只找逐條回饋的那一組
      const notDone = panel.locator(".crew-review__followed-list .crew-review__feedback").first().getByRole("button", { name: ct.review.feedbackGuidelineNotDone, exact: true });
      await notDone.click();
      await expect(notDone).toHaveAttribute("aria-pressed", "true");
      await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
      await panel.getByRole("radio", { name: ct.review.reasonWrong, exact: true }).check();
      await panel.getByRole("checkbox", { name: ct.review.correctionNotInPoints, exact: true }).check();
      await panel.getByRole("button", { name: ct.review.confirmReturn, exact: true }).click();
      await expect(panel.getByText(ct.review.notInPointsShown, { exact: true })).toBeVisible();

      await gotoCrewSection(page, ct.common.sectionEmployees);
      await expect(guidelineItem(page, "linden", "g05").locator(".crew-employees__guideline-not-done")).toHaveText(notDoneText(1));

      await expect(trustRow(page, "linden", "knowledge").locator(".crew-trust__miss")).toHaveText(missSummary(1, 2));
      await gotoRecordsStats(page);
      await expect(notInPointsCell(page, "linden", "knowledge")).toHaveText("2");
      // 一般的做錯了：層級變化仍是 reportChangeAutoReset
      await expect(reportRow(page, "linden", "knowledge")).toContainText(ct.trust.reportChangeAutoReset);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test("k12 事後更正 → 報表的層級變化是「事後更正後自動改回逐項看」", async ({ page }, testInfo) => {
      const panel = await openWork(page, "k12");
      await panel.getByRole("button", { name: ct.review.correctionOpen, exact: true }).click();
      await panel.getByRole("textbox", { name: ct.review.correctionNote, exact: true }).fill("Cutoff is 15:00, not 17:00");
      await panel.getByRole("button", { name: ct.review.correctionSubmit, exact: true }).click();
      await expect(panel.getByRole("button", { name: ct.review.correctionOpen, exact: true })).toHaveCount(0);

      await gotoCrewSection(page, ct.common.sectionEmployees);
      await expect(trustRow(page, "linden", "knowledge").locator(".crew-trust__miss")).toHaveText(missSummary(2, 1));
      await gotoRecordsStats(page);
      const linden = reportRow(page, "linden", "knowledge");
      await expect(linden).toContainText(ct.trust.reportChangeAutoResetCorrection);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "report-correction", linden);
    });
  });
}
