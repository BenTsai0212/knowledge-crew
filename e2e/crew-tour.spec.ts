// 第一次來的導覽（#122）：首頁的入口小卡（可以關掉、可以重新看）、8 步都切到對應的畫面並標出區塊、鍵盤與 Esc、桌機 1280 與手機 390。
// 不自動彈出：進入首頁時只有入口小卡，沒有對話框（線上 demo 的「直接體驗」在 crew-only.spec.ts）。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { gotoView, openApp, switchIdentity } from "./support/app";
import { access } from "./support/client";
import { ct, hasCrewDemo, homeToday, tourCard, tourDialog, tourReplay, walkTour } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 AI 員工，不顯示導覽）");

const manager = access.roles.find((r) => r.canReview)!;

async function openHome(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, manager.id);
  expect(await gotoView(page, "home")).toBe(true);
  await expect(homeToday(page)).toBeVisible();
}

const seen = (page: Page) => page.evaluate(() => localStorage.getItem("knowledge-crew.tour.seen"));

for (const viewport of [
  { name: "桌機 1280", size: { width: 1280, height: 800 }, keyboard: false },
  { name: "手機 390", size: { width: 390, height: 844 }, keyboard: true },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: viewport.size });

    test("首頁有入口小卡、不自動彈出；走完 8 步後小卡換成「重新看導覽」並記住看過", async ({ page }) => {
      await openHome(page);
      await expect(tourCard(page)).toBeVisible();
      await expect(tourDialog(page)).toHaveCount(0);
      // 小卡在「今天的工作」上方
      expect((await tourCard(page).boundingBox())!.y).toBeLessThan((await homeToday(page).boundingBox())!.y);
      expect(await seen(page)).toBeNull();

      await walkTour(page, { keyboard: viewport.keyboard });
      expect(await seen(page)).toBe("1");
      expect(await gotoView(page, "home")).toBe(true);
      await expect(tourCard(page)).toHaveCount(0);
      await expect(tourReplay(page)).toBeVisible();
    });
  });
}

test.describe("桌機 1280：關掉與 Esc", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("關掉小卡後留下「重新看導覽」；重新看時 Esc 結束，焦點回到「重新看導覽」", async ({ page }) => {
    await openHome(page);
    await tourCard(page).getByRole("button", { name: ct.tour.dismiss, exact: true }).click();
    await expect(tourCard(page)).toHaveCount(0);
    await expect(tourReplay(page)).toBeVisible();
    expect(await seen(page)).toBe("1");

    await tourReplay(page).click();
    const dialog = tourDialog(page);
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(ct.tour.todayTitle);
    // 螢幕閱讀器：對話框的名稱是這一步的標題，說明是這一步的一句話
    await expect(dialog).toHaveAccessibleName(ct.tour.todayTitle);
    await expect(dialog).toHaveAccessibleDescription(ct.tour.todayBody);
    await expect(dialog.getByRole("button", { name: ct.tour.next, exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".crew-tour__spot")).toHaveCount(0);
    await expect(tourReplay(page)).toBeFocused();
  });

  test("中途以「結束導覽」結束：停在當時的畫面，不再顯示對話框", async ({ page }) => {
    await openHome(page);
    await tourCard(page).getByRole("button", { name: ct.tour.start, exact: true }).click();
    await tourDialog(page).getByRole("button", { name: ct.tour.next, exact: true }).click();
    await expect(tourDialog(page).getByRole("heading", { level: 2 })).toHaveText(ct.tour.reviewTitle);
    await tourDialog(page).getByRole("button", { name: ct.tour.end, exact: true }).click();
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(page.locator('[data-view="crew"][aria-current="page"]').first()).toBeVisible();
    expect(await seen(page)).toBe("1");
  });
});
