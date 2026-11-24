// AI 員工的手機版（#103，設計規格 v3 第 5、6.2 節）：子頁是可橫向滑動的按鈕列（數字只給能驗收的身分），
// 驗收的決定列固定在底部分頁列之上，不蓋住內容的最後一段，退回原因可以正常選擇；桌機的子導覽仍是頁籤。
// 只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { ct, crewSections, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const sectionButton = (page: Page, label: string) => crewSections(page).getByRole("button", { name: label, exact: true });
const countOf = (button: Locator) => button.locator(".crew-page__count");
const reviewList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
// 「工作與驗收」清單的第一組（待驗收）
const awaitingItems = (page: Page) => reviewList(page).locator("section").first().getByRole("listitem");
const decisionBar = (page: Page) => page.locator(".crew-review__decision");
const tabbar = (page: Page) => page.locator(".mobile-tabbar");
// 看重點的件（#102）：Linden 的 k13
const k13Title = hasCrewDemo
  ? readClientJson<{ assignments: { id: string; title: Record<string, string> }[] }>("crew/demo.json").assignments.find((a) => a.id === "k13")!.title[language]
  : "";

async function openCrewAs(page: Page, role: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, role);
  await openCrew(page);
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

test.describe("手機 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("主管：子頁按鈕列可以橫向滑動、目前的子頁捲進畫面，數字是待驗收件數與看重點的建議數", async ({ page }) => {
    await openCrewAs(page, "manager");
    const nav = crewSections(page);
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    for (const button of await nav.getByRole("button").all()) expect((await box(button)).height).toBeGreaterThanOrEqual(44);

    // 預設停在「工作與驗收」：數字與清單的待驗收件數相同，說明在 aria-describedby（按鈕的名稱仍是子頁名稱）
    const works = sectionButton(page, ct.common.sectionWorks);
    await expect(works).toHaveAttribute("aria-current", "page");
    const awaiting = await awaitingItems(page).count();
    expect(awaiting).toBeGreaterThan(0);
    await expect(countOf(works)).toHaveText(String(awaiting));
    await expect(works).toHaveAccessibleDescription(new RegExp(String(awaiting)));

    // 信任的數字與「同意改看重點」的按鈕數相同
    const trust = sectionButton(page, ct.common.sectionTrust);
    await gotoCrewSection(page, ct.common.sectionTrust);
    const suggestions = await page.getByRole("button", { name: ct.trust.agreeRelax, exact: true }).count();
    if (suggestions === 0) await expect(countOf(trust)).toHaveCount(0);
    else await expect(countOf(trust)).toHaveText(String(suggestions));

    // 最後一個子頁（一開始在畫面外）：點了之後整個捲進按鈕列
    await nav.evaluate((el) => (el.scrollLeft = 0));
    const ledger = sectionButton(page, ct.common.sectionLedger);
    await ledger.click();
    await expect(ledger).toHaveAttribute("aria-current", "page");
    await expect
      .poll(async () => {
        const [row, button] = [await box(nav), await box(ledger)];
        return button.x >= row.x - 1 && button.x + button.width <= row.x + row.width + 1;
      })
      .toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("主管：決定列固定在底部分頁列之上，捲到最後不蓋住內容；退回原因可以選擇與確定", async ({ page }) => {
    await openCrewAs(page, "manager");
    const bar = decisionBar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: ct.review.accept, exact: true })).toBeVisible();

    // 面板的開頭：決定列貼在分頁列上緣，分頁列沒有被蓋住
    await page.evaluate(() => window.scrollTo(0, 0));
    const tabTop = (await box(tabbar(page))).y;
    await expect.poll(async () => Math.round((await box(bar)).y + (await box(bar)).height)).toBe(Math.round(tabTop));
    for (const button of await bar.getByRole("button").all()) expect((await box(button)).height).toBeGreaterThanOrEqual(48);
    expect(await tabbar(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })).toBe(true);

    // 捲到面板最後：決定列回到原位，前一段內容在它上方、沒有被蓋住
    // （sticky 的元素 scrollIntoView 不會捲動，改以面板的下緣捲到分頁列之上）
    await bar.evaluate((el) => {
      const panel = el.closest("article")!;
      window.scrollBy(0, panel.getBoundingClientRect().bottom - (window.innerHeight - 72 - 16));
    });
    const last = bar.locator("xpath=preceding-sibling::*[1]");
    await expect.poll(async () => (await box(last)).y + (await box(last)).height <= (await box(bar)).y + 1).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);

    // 退回：取消固定，原因與「確定退回」在分頁列之上可以操作
    await page.evaluate(() => window.scrollTo(0, 0));
    await bar.getByRole("button", { name: ct.review.return, exact: true }).click();
    await expect(bar).toHaveAttribute("data-returning", "true");
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    const radio = bar.getByRole("radio", { name: ct.review.reasonProcess, exact: true });
    await radio.check();
    await expect(radio).toBeChecked();
    const confirm = bar.getByRole("button", { name: ct.review.confirmReturn, exact: true });
    await confirm.scrollIntoViewIfNeeded();
    expect((await box(confirm)).y + (await box(confirm)).height).toBeLessThanOrEqual((await box(tabbar(page))).y);
    await confirm.click();
    await expect(reviewList(page).getByText(ct.review.verdictReturned, { exact: true }).first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("主管：看重點的件（#102 的 k13）決定列仍固定在分頁列之上；展開收起的欄位與變更後，捲到最後決定列回到原位", async ({ page }) => {
    await openCrewAs(page, "manager");
    await reviewList(page).getByRole("button").filter({ hasText: k13Title }).click();
    const panel = reviewPanel(page, k13Title);
    await expect(panel.getByRole("region", { name: ct.review.lightTitle })).toBeVisible();
    const bar = panel.locator(".crew-review__decision");
    await expect(bar).toBeVisible();

    // 面板的開頭：決定列貼在分頁列上緣
    await panel.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 8));
    const tabTop = Math.round((await box(tabbar(page))).y);
    await expect.poll(async () => Math.round((await box(bar)).y + (await box(bar)).height)).toBe(tabTop);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

    // 展開「其他 N 個欄位已收起」與「逐項列出」
    const toggle = panel.locator(".crew-collapsed__toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await panel.getByRole("button", { name: ct.review.changesList, exact: true }).click();
    const items = panel.locator(".crew-review__changes-items li");
    await expect(items.first()).toBeVisible();

    // 捲到面板最後：決定列回到原位，展開的內容（最後一項變更、前一段）都在它上方，沒有被蓋住
    await bar.evaluate((el) => {
      const article = el.closest("article")!;
      window.scrollBy(0, article.getBoundingClientRect().bottom - (window.innerHeight - 72 - 16));
    });
    const last = bar.locator("xpath=preceding-sibling::*[1]");
    await expect.poll(async () => (await box(last)).y + (await box(last)).height <= (await box(bar)).y + 1).toBe(true);
    const lastItem = items.last();
    expect((await box(lastItem)).y + (await box(lastItem)).height).toBeLessThanOrEqual((await box(bar)).y + 1);
    expect((await box(bar)).y + (await box(bar)).height).toBeLessThanOrEqual((await box(tabbar(page))).y + 1);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  for (const role of ["staff", "guest"]) {
    test(`${role}：沒有固定的決定列，子導覽沒有數字`, async ({ page }) => {
      await openCrewAs(page, role);
      await expect(sectionButton(page, ct.common.sectionWorks)).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".crew-review, .empty-state").first()).toBeVisible();
      await expect(decisionBar(page)).toHaveCount(0);
      await expect(crewSections(page).locator(".crew-page__count")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("子導覽仍是頁籤（底線、沒有框），決定列不固定", async ({ page }) => {
    await openCrewAs(page, "manager");
    const works = sectionButton(page, ct.common.sectionWorks);
    const style = await works.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, top: s.borderTopWidth, bottom: s.borderBottomWidth };
    });
    expect(style).toEqual({ radius: "0px", top: "0px", bottom: "2px" });
    await expect(countOf(works)).toHaveText(String(await awaitingItems(page).count()));
    expect(await decisionBar(page).evaluate((el) => getComputedStyle(el).position)).toBe("static");
  });
});
