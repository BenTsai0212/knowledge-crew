// 驗收面板 v3（#72 計畫第 7 點）：結論列、重點的標記、退回原因的「影響信任」、手機寬度不破版。
// 只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。點重點與四種交件各自的畫面在之後的 PR 加上。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson, theme } from "./support/client";
import { crewContent, crewFill, ct, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");
test.use({ viewport: { width: 1440, height: 900 } });

const glossary = hasCrewDemo ? readClientJson<Record<string, string>>(`i18n/crew/glossary.${language}.json`) : {};
type DemoAssignment = { id: string; title: Record<string, string>; works: { changes: { summary: Record<string, string> }[] }[] };
const assignments = hasCrewDemo ? readClientJson<{ assignments: DemoAssignment[] }>("crew/demo.json").assignments : [];
const titles = new Map(assignments.map((a) => [a.id, a.title[language]]));
// 最新一輪第 i 項變更的說明
const demoChange = (id: string, i: number) => assignments.find((a) => a.id === id)!.works.at(-1)!.changes[i].summary[language];

// theme.json 的顏色（#RRGGBB）→ getComputedStyle 的寫法
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function openWork(page: Page, id: string): Promise<Locator> {
  const title = titles.get(id)!;
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  return panel;
}

const pointsCard = (panel: Locator) => panel.locator("section").filter({ has: panel.page().getByRole("heading", { name: ct.review.points, exact: true }) });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
});

test("結論列：未通過是「先別寄出」，檢查中是「還在檢查」，已驗收的工作沒有結論列", async ({ page }) => {
  const s14 = await openWork(page, "s14");
  const fail = crewFill(ct.review.conclusionFail, { verb: ct.review.verbReply, checks: glossary.checkQuoteMatch });
  await expect(s14.locator(".crew-conclusion[data-tone=fail]").getByText(fail, { exact: true })).toBeVisible();

  const c11 = await openWork(page, "c11");
  const pending = crewFill(ct.review.conclusionPending, { checks: glossary.checkLinks });
  await expect(c11.locator(".crew-conclusion[data-tone=pending]").getByText(pending, { exact: true })).toBeVisible();

  const recent = page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: ct.review.verdictAccepted }).first();
  await recent.click();
  const decided = crewContent(page).getByRole("article").first();
  await expect(decided.getByText(ct.review.verdictAccepted, { exact: true })).toBeVisible();
  await expect(decided.locator(".crew-conclusion")).toHaveCount(0);
  await expect(decided.getByText(ct.review.decisionReply, { exact: true })).toHaveCount(0);
});

test("重點：重點卡列出內容中的位置，內容中的對應文字有編號的標記", async ({ page }) => {
  const panel = await openWork(page, "s14");
  const items = pointsCard(panel).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(glossary.positionReplyP2);
  const body = panel.getByRole("article", { name: ct.review.deliverableReply });
  await expect(body.locator('[data-point="1"]')).toHaveCount(1);
  await expect(body.locator('[data-point="1"]')).toContainText(crewFill(ct.review.pointMark, { n: 1 }));
  await expect(body.getByText(crewFill(ct.review.modified, { summary: demoChange("s14", 0) }), { exact: true })).toBeVisible();
});

test("決定列與退回：問句、三張原因卡，「做錯了」的「影響信任」是 danger 字，「確定退回」是墨色", async ({ page }) => {
  const panel = await openWork(page, "s14");
  await expect(panel.getByText(ct.review.decisionReply, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
  for (const reason of [ct.review.reasonWrong, ct.review.reasonDifferentApproach, ct.review.reasonProcess]) {
    await expect(panel.getByRole("radio", { name: reason, exact: true })).toBeVisible();
  }
  const wrong = panel.locator("label").filter({ has: page.getByRole("radio", { name: ct.review.reasonWrong, exact: true }) });
  await expect(wrong.getByText(ct.review.impactTrust, { exact: true })).toHaveCSS("color", rgb(theme.colors.danger));
  await expect(panel.getByText(ct.review.impactNone, { exact: true })).toHaveCount(2);
  const confirm = panel.getByRole("button", { name: ct.review.confirmReturn, exact: true });
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveCSS("background-color", rgb(theme.colors.text));
  await wrong.click();
  await expect(confirm).toBeEnabled();
});

test("手機寬度（390px）：驗收面板沒有水平捲動", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWork(page, "s14");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
