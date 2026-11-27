// 驗收面板的自述／獨立檢查分區與逐條回饋（#168，crew ADR 0008 第 12～16 點）：
// k13 面板有兩個分區；對重點 1 選「有問題」、守則選「沒做到」（鍵盤操作）後退回（做錯了、勾「沒被標成重點」），重新打開那一輪看到唯讀標籤；
// 已驗收的 k12 是唯讀標籤；逐項看的面板同樣分區。桌機 1280 與手機 390 各跑一次，截圖附在測試報告（`feedback-*.png`）。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { assignmentTitle, crewFill, ct, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const workList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
const zone = (panel: Locator, title: string) => panel.getByRole("region", { name: title, exact: true });
const pointGroups = (panel: Locator) => panel.locator(".crew-review__points").getByRole("group");
const guidelineGroups = (panel: Locator) => panel.locator(".crew-review__followed-list").getByRole("group");
const tag = (scope: Locator, text: string) => scope.locator(".crew-review__feedback-tag").filter({ hasText: text });

async function shot(page: Page, testInfo: TestInfo, name: string, target?: Locator): Promise<void> {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: true });
  await testInfo.attach(`feedback-${name}-${page.viewportSize()!.width}px.png`, { body, contentType: "image/png" });
}

async function openWork(page: Page, id: string): Promise<Locator> {
  await workList(page).getByRole("button").filter({ hasText: assignmentTitle(id) }).click();
  const panel = reviewPanel(page, assignmentTitle(id));
  await expect(panel).toBeVisible();
  return panel;
}

/** 兩個分區：標題是 h4（面板標題 h3 之下），「員工自己說的」在「獨立檢查」之上 */
async function expectZones(panel: Locator): Promise<void> {
  const self = zone(panel, ct.review.groupSelf);
  const independent = zone(panel, ct.review.groupIndependent);
  await expect(self.getByRole("heading", { level: 4, name: ct.review.groupSelf, exact: true })).toBeVisible();
  await expect(independent.getByRole("heading", { level: 4, name: ct.review.groupIndependent, exact: true })).toBeVisible();
  await expect(self.getByText(ct.review.groupSelfHint, { exact: true })).toBeVisible();
  await expect(independent.getByText(ct.review.groupIndependentHint, { exact: true })).toBeVisible();
  await expect(self.getByRole("heading", { level: 5, name: ct.review.points, exact: true })).toBeVisible();
  await expect(independent.getByRole("heading", { level: 5, name: ct.review.checks, exact: true })).toBeVisible();
  expect((await self.boundingBox())!.y).toBeLessThan((await independent.boundingBox())!.y);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
});

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("k13：分區與逐條回饋（鍵盤）→ 退回（做錯了、沒被標成重點）→ 重新打開是唯讀標籤", async ({ page }, testInfo) => {
      const panel = await openWork(page, "k13");
      await expectZones(panel);
      await expect(zone(panel, ct.review.groupSelf).getByText(ct.review.feedbackHint, { exact: true })).toBeVisible();
      await shot(page, testInfo, "k13-zones");

      // 重點 1：Tab 移到「沒問題」再到「有問題」，Enter 選取；再按一次取消、Space 再選
      const point = pointGroups(panel).first();
      const ok = point.getByRole("button", { name: ct.review.feedbackPointOk, exact: true });
      const problem = point.getByRole("button", { name: ct.review.feedbackPointProblem, exact: true });
      await ok.focus();
      await page.keyboard.press("Tab");
      await expect(problem).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(problem).toHaveAttribute("aria-pressed", "true");
      await expect(ok).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Enter");
      await expect(problem).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Space");
      await expect(problem).toHaveAttribute("aria-pressed", "true");
      // 同一對象最多選一個
      await ok.click();
      await expect(ok).toHaveAttribute("aria-pressed", "true");
      await expect(problem).toHaveAttribute("aria-pressed", "false");
      await problem.click();

      const guideline = guidelineGroups(panel).first();
      const notDone = guideline.getByRole("button", { name: ct.review.feedbackGuidelineNotDone, exact: true });
      await notDone.focus();
      await page.keyboard.press("Space");
      await expect(notDone).toHaveAttribute("aria-pressed", "true");
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k13-selecting", zone(panel, ct.review.groupSelf));

      // 退回：選「做錯了」才出現「沒被標成重點」；換成其他原因時隱藏並取消勾選
      await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
      const notInPoints = panel.getByRole("checkbox", { name: ct.review.correctionNotInPoints, exact: true });
      await expect(notInPoints).toHaveCount(0);
      await panel.getByRole("radio", { name: ct.review.reasonWrong, exact: true }).check();
      await notInPoints.check();
      await panel.getByRole("radio", { name: ct.review.reasonProcess, exact: true }).check();
      await expect(notInPoints).toHaveCount(0);
      await panel.getByRole("radio", { name: ct.review.reasonWrong, exact: true }).check();
      await expect(notInPoints).not.toBeChecked();
      await notInPoints.check();
      await panel.getByRole("button", { name: ct.review.confirmReturn, exact: true }).click();
      await expect(panel.getByText(ct.review.verdictReturned, { exact: true }).first()).toBeVisible();

      // 換一件再重新打開那一輪：唯讀標籤、沒有按鈕、退回原因旁有「這個錯沒有被標成重點」
      await openWork(page, "k17");
      const again = await openWork(page, "k13");
      await expectZones(again);
      await expect(again.getByRole("group")).toHaveCount(0);
      await expect(zone(again, ct.review.groupSelf).getByText(ct.review.feedbackHint, { exact: true })).toHaveCount(0);
      await expect(tag(again.locator(".crew-review__points"), ct.review.feedbackPointProblem)).toHaveCount(1);
      await expect(tag(again.locator(".crew-review__followed-list"), ct.review.feedbackGuidelineNotDone)).toHaveCount(1);
      await expect(again.locator(".crew-review__head").getByText(ct.review.notInPointsShown, { exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k13-returned");
    });

    test("已驗收的 k12：重點 1 沒問題、重點 2 有問題、守則做到是唯讀標籤", async ({ page }, testInfo) => {
      const panel = await openWork(page, "k12");
      await expectZones(panel);
      await expect(panel.getByRole("group")).toHaveCount(0);
      const points = panel.locator(".crew-review__points > li");
      await expect(tag(points.nth(0), ct.review.feedbackPointOk)).toHaveCount(1);
      await expect(tag(points.nth(1), ct.review.feedbackPointProblem)).toHaveCount(1);
      await expect(tag(panel.locator(".crew-review__followed-list"), ct.review.feedbackGuidelineDone)).toHaveCount(1);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k12-tags", zone(panel, ct.review.groupSelf));
    });

    test("逐項看的面板（s14）同樣分兩區，切換按鈕在重點旁", async ({ page }, testInfo) => {
      const panel = await openWork(page, "s14");
      await expect(panel.locator(".crew-level-badge")).toHaveText(crewFill(ct.review.levelBadge, { level: ct.review.levelItem }));
      await expectZones(panel);
      await expect(pointGroups(panel).first().getByRole("button")).toHaveCount(2);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "s14-zones");
    });
  });
}
