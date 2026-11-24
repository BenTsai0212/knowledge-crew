// 「員工」的員工卡（#83，設計規格 v3 第 6.5 節）：四張卡、最近 10 次圓點的摘要、「看信任紀錄」與「交辦給 ○○」預選員工，
// 只能查看的身分沒有「交辦給 ○○」，手機 390 不破版。每個 test 重新開頁，資料庫在瀏覽器記憶體中從 migration 與虛構資料重建。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { crewFill, crewSections, ct, demo, employeeName, gotoCrewSection, hasCrewDemo, openCrew, sourceLabel, sourceOf, workTypeName } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

async function openEmployeesAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionEmployees);
}

const card = (page: Page, id: string) => page.getByRole("region", { name: employeeName(id) });
const dots = (c: Locator) => c.getByRole("img").filter({ has: c.page().locator(".crew-dot") });
const summary = (parts: [string, number][]) => parts.map(([key, count]) => crewFill(key, { count })).join(ct.trust.dotsAriaSeparator);
// 「交辦給 {employee}」：員工名字前有 AI 標記，以名字之後的部分比對
const assignLink = (c: Locator, id: string) =>
  c.getByRole("button", { name: new RegExp(`${ct.employees.linkAssign.split("{employee}")[0]}.*${employeeName(id)}`) });

test.describe("員工卡（主管，桌機 1280）", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ page }) => openEmployeesAs(page, "manager"));

  test("頁首與四張卡（兩欄）", async ({ page }) => {
    const count = demo.employees.length;
    expect(count).toBe(4);
    await expect(page.getByRole("heading", { level: 2 })).toContainText(String(count));
    await expect(page.getByText(ct.employees.intro, { exact: true })).toBeVisible();
    for (const e of demo.employees) await expect(card(page, e.id)).toBeVisible();
    const [a, b] = await Promise.all([card(page, "juniper").boundingBox(), card(page, "linden").boundingBox()]);
    expect(Math.round(a!.y)).toBe(Math.round(b!.y));
  });

  test("Rowan：交件、來源、圓點的摘要與做錯了的說明", async ({ page }) => {
    const rowan = card(page, "rowan");
    await expect(rowan.getByText(ct.review.deliverableReply, { exact: true })).toBeVisible();
    await expect(rowan.getByText(sourceLabel(sourceOf("rowan", "support")), { exact: true })).toBeVisible();
    await expect(dots(rowan)).toHaveAttribute("aria-label", summary([[ct.trust.dotsAriaOk, 9], [ct.trust.dotsAriaWrong, 1]]));
    await expect(dots(rowan).locator(".crew-dot")).toHaveCount(10);
    await expect(rowan.getByText(crewFill(ct.employees.noteReset, { date: "10/15" }), { exact: true })).toBeVisible();
  });

  test("Sorrel 有看重點的建議；Juniper 10 個圓點，同意改看重點後又收回（#125）", async ({ page }) => {
    await expect(card(page, "sorrel").getByText(ct.employees.noteSuggestion, { exact: true })).toBeVisible();
    await expect(dots(card(page, "juniper")).locator(".crew-dot")).toHaveCount(10);
    await expect(card(page, "juniper").getByText(crewFill(ct.employees.noteRevoke, { date: "10/24" }), { exact: true })).toBeVisible();
  });

  test("「交辦給 Linden」切到交辦頁並預選 Linden 與平常的來源", async ({ page }) => {
    await assignLink(card(page, "linden"), "linden").click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionAssignments, exact: true })).toHaveAttribute("aria-current", "page");
    const form = page.getByRole("form", { name: ct.assign.formTitle });
    await expect(form.getByRole("radio", { name: new RegExp(employeeName("linden")) })).toBeChecked();
    await expect(form.getByLabel(new RegExp(`^${ct.assign.fieldSource}`))).toHaveValue(sourceOf("linden", "knowledge").id);
    await expect(form.getByLabel(new RegExp(`^${ct.assign.fieldWorkType}`))).toHaveValue(workTypeName("knowledge"));
  });

  test("「看信任紀錄」切到信任頁", async ({ page }) => {
    await card(page, "rowan").getByRole("button", { name: ct.employees.linkTrust, exact: true }).click();
    await expect(page.getByRole("heading", { name: ct.trust.title, exact: true })).toBeVisible();
  });
});

test("staff：沒有「交辦給 ○○」，有「看信任紀錄」", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openEmployeesAs(page, "staff");
  const rowan = card(page, "rowan");
  await expect(rowan.getByRole("button", { name: ct.employees.linkTrust, exact: true })).toBeVisible();
  await expect(assignLink(rowan, "rowan")).toHaveCount(0);
});

test("手機 390：一欄、沒有水平捲動，圓點在卡片內", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEmployeesAs(page, "manager");
  const rowan = card(page, "rowan");
  await expect(dots(rowan)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = (await rowan.boundingBox())!;
  const row = (await dots(rowan).boundingBox())!;
  expect(row.x + row.width).toBeLessThanOrEqual(box.x + box.width);
  const [a, b] = await Promise.all([card(page, "juniper").boundingBox(), card(page, "linden").boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y);
});
