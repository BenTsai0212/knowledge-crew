// 守則的畫面（#145，ADR 0007）：首頁的等你確認 → 員工頁確認 → 子導覽與摘要的數字改變 → 帳本的「確認守則」；
// 退回時記成守則；收回；staff 只看得到內容。1280 與 390 各跑一次主要流程。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { DemoFile } from "../app/src/crew/demo/types";
import { gotoView, openApp, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { assignmentTitle, crewContent, crewFill, crewSections, ct, employeeName, gotoCrewSection, hasCrewDemo, homeToday, openCrew, reviewPanel, workTypeName } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const guidelines = hasCrewDemo ? readClientJson<DemoFile>("crew/demo.json").guidelines : [];
const text = (id: string) => guidelines.find((g) => g.id === id)!.text[language];

const card = (page: Page, id: string) => page.getByRole("region", { name: employeeName(id) }).filter({ has: page.locator(".crew-employees__top") });
const section = (c: Locator) => c.getByRole("region", { name: ct.employees.guidelinesTitle, exact: true });
const item = (c: Locator, guideline: string) => section(c).getByRole("listitem").filter({ hasText: guideline });
const employeesButton = (page: Page) => crewSections(page).getByRole("button", { name: ct.common.sectionEmployees, exact: true });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// 「守則 n 條・等你確認 n 條」（zh-TW 沒有單複數；en 的單複數由畫面處理，這裡只比對 zh-TW 的寫法時才用）
const summary = (active: number, pending: number) =>
  [active > 0 ? crewFill(ct.employees.guidelinesActive, { count: active }) : null, pending > 0 ? crewFill(ct.employees.guidelinesPending, { count: pending }) : null]
    .filter((x) => x !== null)
    .join(ct.employees.guidelinesSeparator);

async function openAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
}

async function openEmployees(page: Page): Promise<void> {
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionEmployees);
}

for (const width of [1280, 390]) {
  test(`主管（${width}）：首頁看到 Rowan 的守則等確認 → 員工頁確認 → 數字改變 → 帳本出現「確認守則」`, async ({ page }) => {
    test.skip(ct.employees.guidelinesActive.includes(", plural"), "摘要的比對只寫了沒有單複數的語言");
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openAs(page, "manager");
    expect(await gotoView(page, "home")).toBe(true);
    const decide = homeToday(page).getByRole("region", { name: ct.home.groupDecide, exact: true });
    const row = decide.getByRole("listitem").filter({ hasText: crewFill(ct.home.guidelineItem, { employee: "", workType: workTypeName("support") }).trim() });
    await expect(row).toContainText(employeeName("rowan"));
    await expect(row.getByText(ct.home.guidelineNote, { exact: true })).toBeVisible();
    await row.getByRole("button").click();

    await expect(employeesButton(page)).toHaveAttribute("aria-current", "page");
    await expect(employeesButton(page).locator(".crew-page__count")).toHaveText("1");
    const rowan = card(page, "rowan");
    await expect(rowan).toBeInViewport();
    await expect(section(rowan).getByText(summary(1, 1), { exact: true })).toBeVisible();
    // 等確認的排最前：來歷與三個按鈕
    const pending = item(rowan, text("g02"));
    await expect(section(rowan).getByRole("listitem").first()).toContainText(text("g02"));
    for (const name of [ct.employees.guidelineConfirm, ct.employees.guidelineEditConfirm, ct.employees.guidelineDecline]) {
      await expect(pending.getByRole("button", { name, exact: true })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await pending.getByRole("button", { name: ct.employees.guidelineConfirm, exact: true }).click();

    await expect(section(rowan).getByText(summary(2, 0), { exact: true })).toBeVisible();
    await expect(employeesButton(page).locator(".crew-page__count")).toHaveCount(0);
    await expect(item(rowan, text("g02")).getByRole("button", { name: ct.employees.guidelineRetire, exact: true })).toBeVisible();

    await gotoCrewSection(page, ct.common.sectionLedger);
    await crewContent(page).getByRole("combobox", { name: new RegExp(`^${ct.ledger.filterEvent}`) }).selectOption({ label: ct.ledger.eventGuideline });
    const first = page.getByRole("table", { name: ct.ledger.listLabel }).locator("tbody").getByRole("row").first();
    await expect(first).toContainText(ct.ledger.kindGuidelineConfirmed);
    await expect(first).toContainText(employeeName("rowan"));
    // 工作欄是守則的文字，點了追到來源交辦（s12）
    await first.getByRole("button").click();
    await expect(reviewPanel(page, assignmentTitle("s12"))).toBeVisible();
  });
}

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("主管：退回一件交件並記成守則 → 員工頁出現這條，來歷是「退回時記下」", async ({ page }) => {
    await openAs(page, "manager");
    await openCrew(page);
    await gotoCrewSection(page, ct.common.sectionWorks);
    const title = assignmentTitle("s14");
    await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
    const panel = reviewPanel(page, title);
    await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
    // 「流程上的小問題」不顯示勾選框；其他兩種顯示，預設不勾
    await panel.getByRole("radio", { name: ct.review.reasonProcess, exact: true }).check();
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    await panel.getByRole("radio", { name: ct.review.reasonDifferentApproach, exact: true }).check();
    const check = panel.getByRole("checkbox");
    await expect(check).not.toBeChecked();
    await expect(panel.getByText(ct.review.saveAsGuidelineHint, { exact: true })).toBeVisible();
    // 勾了但意見是空的：顯示錯誤並停下；改動意見後錯誤消失
    await check.check();
    const confirm = panel.getByRole("button", { name: ct.review.confirmReturn, exact: true });
    await confirm.click();
    await expect(panel.getByText(ct.review.guidelineNeedsNote, { exact: true })).toBeVisible();
    const note = "報價要附上有效期限";
    await panel.getByRole("textbox").fill(note);
    await expect(panel.getByText(ct.review.guidelineNeedsNote, { exact: true })).toHaveCount(0);
    await confirm.click();
    await expect(panel.getByText(ct.review.guidelineSaved, { exact: true })).toBeVisible();

    await gotoCrewSection(page, ct.common.sectionEmployees);
    const saved = item(card(page, "rowan"), note);
    await expect(saved).toBeVisible();
    await expect(saved).toContainText(ct.employees.guidelineSavedOnReturn.replace("{date}", "").trim());
  });

  test("主管：收回一條守則 → 先問，確定後移到「已收回」", async ({ page }) => {
    await openAs(page, "manager");
    await openEmployees(page);
    const rowan = card(page, "rowan");
    const active = item(rowan, text("g01"));
    await active.getByRole("button", { name: ct.employees.guidelineRetire, exact: true }).click();
    await expect(active.getByText(ct.employees.guidelineRetireAsk, { exact: true })).toBeVisible();
    await active.getByRole("group").getByRole("button", { name: ct.employees.guidelineRetire, exact: true }).click();

    const closed = section(rowan).locator("details");
    await expect(closed.locator("summary")).toHaveText(crewFill(ct.employees.guidelinesRetired, { count: 1 }));
    await closed.locator("summary").click();
    const retired = closed.getByRole("listitem").filter({ hasText: text("g01") });
    await expect(retired).toBeVisible();
    await expect(retired.getByRole("button", { name: ct.employees.guidelineRetire, exact: true })).toHaveCount(0);
  });

  test("staff：看得到青翼專案的守則，沒有決定的按鈕，子導覽沒有數字", async ({ page }) => {
    await openAs(page, "staff");
    await openEmployees(page);
    const rowan = card(page, "rowan");
    await expect(item(rowan, text("g01"))).toBeVisible();
    await expect(item(rowan, text("g02"))).toBeVisible();
    await expect(item(card(page, "sorrel"), text("g03"))).toBeVisible();
    for (const name of [ct.employees.guidelineConfirm, ct.employees.guidelineEditConfirm, ct.employees.guidelineDecline, ct.employees.guidelineRetire]) {
      await expect(crewContent(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(item(rowan, text("g01")).getByRole("button", { name: ct.employees.guidelineOpenReturn, exact: true })).toBeVisible();
    await expect(employeesButton(page).locator(".crew-page__count")).toHaveCount(0);
  });
});
