// 驗收面板的「請你確認」「系統檢查」兩區（#195）與逐條回饋（#168，crew ADR 0008 第 12～16 點）：
// k13 面板有兩區；對重點 1 選「有問題」、守則選「沒做到」（鍵盤操作）後退回（做錯了、勾「沒被標成重點」），重新打開那一輪看到唯讀標籤；
// 已驗收的 k12 是唯讀標籤；全部看的面板同樣兩區。桌機 1280 與手機 390 各跑一次，截圖附在測試報告（`feedback-*.png`）。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { assignmentTitle, ct, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const workList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
// 「請你確認」與「系統檢查」兩區（#195：拿掉「員工自己說的」「獨立檢查」分區與說明段落）
const confirmArea = (panel: Locator) => panel.locator(".crew-review__confirm");
const systemArea = (panel: Locator) => panel.locator(".crew-review__system");
const feedbackGroups = (panel: Locator) => panel.locator(".crew-review__feedback");
const pointGroups = (panel: Locator) => panel.locator(".crew-review__points").getByRole("group");
// 守則列另有「?」（details 的 role 也是 group），所以只找逐條回饋的那一組
const guidelineGroups = (panel: Locator) => panel.locator(".crew-review__followed-list .crew-review__feedback");
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

/** 兩區：標題是 h3（面板標題 h2 之下）；720px 以上左右並排（請你確認在左），窄時上下（請你確認在上） */
async function expectZones(panel: Locator): Promise<void> {
  const self = confirmArea(panel);
  const independent = systemArea(panel);
  await expect(self.getByRole("heading", { level: 3 })).toContainText(ct.review.points);
  await expect(independent.getByRole("heading", { level: 3, name: ct.review.checks, exact: true })).toBeVisible();
  await expect(panel.locator(".crew-review__zone")).toHaveCount(0);
  const [a, b] = [(await self.boundingBox())!, (await independent.boundingBox())!];
  if (panel.page().viewportSize()!.width >= 720) {
    expect(a.x).toBeLessThan(b.x);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  } else {
    expect(a.y).toBeLessThan(b.y);
  }
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
      await expect(feedbackGroups(panel).first()).toBeVisible();
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
      await shot(page, testInfo, "k13-selecting", confirmArea(panel));

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
      await expect(feedbackGroups(again)).toHaveCount(0);
      await expect(again.getByRole("group", { name: ct.review.wayLabel, exact: true })).toHaveCount(0);
      await expect(tag(again.locator(".crew-review__points"), ct.review.feedbackPointProblem)).toHaveCount(1);
      await expect(tag(again.locator(".crew-review__followed-list"), ct.review.feedbackGuidelineNotDone)).toHaveCount(1);
      await expect(again.locator(".crew-review__head").getByText(ct.review.notInPointsShown, { exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k13-returned");
    });

    test("已驗收的 k12：重點 1 沒問題、重點 2 有問題、守則做到是唯讀標籤", async ({ page }, testInfo) => {
      const panel = await openWork(page, "k12");
      await expectZones(panel);
      await expect(feedbackGroups(panel)).toHaveCount(0);
      const points = panel.locator(".crew-review__points > li");
      await expect(tag(points.nth(0), ct.review.feedbackPointOk)).toHaveCount(1);
      await expect(tag(points.nth(1), ct.review.feedbackPointProblem)).toHaveCount(1);
      await expect(tag(panel.locator(".crew-review__followed-list"), ct.review.feedbackGuidelineDone)).toHaveCount(1);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k12-tags", confirmArea(panel));
    });

    test("全部看的面板（s14）同樣兩區，切換按鈕在重點旁", async ({ page }, testInfo) => {
      const panel = await openWork(page, "s14");
      await expect(panel.locator(".ui-badge--item")).toHaveText(ct.review.levelItem);
      await expectZones(panel);
      await expect(pointGroups(panel).first().getByRole("button")).toHaveCount(2);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "s14-zones");
    });
  });
}
