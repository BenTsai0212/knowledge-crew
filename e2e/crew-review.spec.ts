// 驗收面板 v3（#72 計畫第 7 點）：結論列、重點的標記與點選、退回原因的「影響信任」、手機寬度不破版。
// 四種交件（回信、貼文、知識庫條目、程式修改）各自的畫面。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson, theme } from "./support/client";
import { crewContent, crewFill, crewSections, ct, employeeName, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");
test.use({ viewport: { width: 1440, height: 900 } });

const glossary = hasCrewDemo ? readClientJson<Record<string, string>>(`i18n/crew/glossary.${language}.json`) : {};
type DemoAssignment = {
  id: string;
  title: Record<string, string>;
  works: { body: Record<string, string>; changes: { summary: Record<string, string> }[] }[];
};
const assignments = hasCrewDemo ? readClientJson<{ assignments: DemoAssignment[] }>("crew/demo.json").assignments : [];
const titles = new Map(assignments.map((a) => [a.id, a.title[language]]));
// 最新一輪第 i 項變更的說明
const demoChange = (id: string, i: number) => assignments.find((a) => a.id === id)!.works.at(-1)!.changes[i].summary[language];

// 最新一輪全文中某個區塊標頭行的名稱（`@@ <鍵> … | <名稱>`）
const demoLabel = (id: string, key: string) =>
  assignments
    .find((a) => a.id === id)!
    .works.at(-1)!
    .body[language].split("\n")
    .find((l) => l.startsWith(`@@ ${key} `))!
    .split("|")[1]
    .trim();

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

test("點重點：按鈕變成 aria-pressed，內容中的對應位置是 surfaceRaised 底，再點一次取消；鍵盤也能操作", async ({ page }) => {
  const panel = await openWork(page, "s14");
  const buttons = pointsCard(panel).getByRole("button");
  await expect(buttons).toHaveCount(2);
  const [first, second] = [buttons.nth(0), buttons.nth(1)];
  const body = panel.getByRole("article", { name: ct.review.deliverableReply });
  const spot = (n: number) => body.locator(`[data-point~="${n}"]`).first();
  const transparent = "rgba(0, 0, 0, 0)";

  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(spot(1)).toHaveCSS("background-color", transparent);
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveCSS("box-shadow", `${rgb(theme.colors.text)} 0px 0px 0px 1px inset`);
  await expect(spot(1)).toHaveCSS("background-color", rgb(theme.colors.surfaceRaised));
  await expect(spot(2)).toHaveCSS("background-color", transparent);
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(spot(1)).toHaveCSS("background-color", transparent);

  await first.focus();
  await page.keyboard.press("Tab");
  await expect(second).toBeFocused();
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(spot(2)).toHaveCSS("background-color", rgb(theme.colors.surfaceRaised));
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

test("回信：上方是寄給與主旨，段落有左側的名稱與「已修改」", async ({ page }) => {
  const panel = await openWork(page, "s14");
  const body = panel.getByRole("article", { name: ct.review.deliverableReply });
  const head = body.locator(".crew-review__reply-head");
  await expect(head.getByText(glossary.positionReplyTo, { exact: true })).toBeVisible();
  await expect(head.getByText(glossary.positionReplySubject, { exact: true })).toBeVisible();
  await expect(head.locator('[data-part="reply/subject"] .crew-review__block-text')).toHaveCSS("font-weight", "700");
  const p2 = body.locator('[data-part="reply/p2"]');
  await expect(p2.getByText(glossary.positionReplyP2, { exact: true })).toBeVisible();
  await expect(p2.getByText(crewFill(ct.review.modified, { summary: demoChange("s14", 0) }), { exact: true })).toBeVisible();
});

test("貼文：帳號列有首字，標籤與圖片說明，圖片是佔位方塊", async ({ page }) => {
  const panel = await openWork(page, "c11");
  const body = panel.getByRole("article", { name: ct.review.deliverablePost });
  await expect(body.locator('[data-part="post/account"] .crew-review__avatar')).toBeVisible();
  for (const label of [glossary.positionPostAccount, glossary.positionPostHashtags, glossary.positionPostImage, glossary.positionPostImageAlt]) {
    await expect(body.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(body.locator('[data-part="post/image"] .crew-review__block-text')).toHaveCSS("border-top-style", "dashed");
  await expect(body.locator("img")).toHaveCount(0);
});

test("知識庫條目：空白的必填欄位是 danger 虛線框的「空白・必填」", async ({ page }) => {
  const panel = await openWork(page, "k13");
  const body = panel.getByRole("article", { name: ct.review.deliverableKb });
  await expect(body.locator(".crew-review__kb-title")).toContainText(demoLabel("k13", "kb/pre-orders"));
  const field = body.locator(".crew-review__block").filter({ has: page.locator("dt", { hasText: demoLabel("k13", "kb/pre-orders#effective-date") }) });
  const empty = field.getByText(ct.review.fieldEmptyRequired, { exact: true });
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS("border-top-style", "dashed");
  await expect(empty).toHaveCSS("border-top-color", rgb(theme.colors.danger));
  await expect(empty).toHaveCSS("color", rgb(theme.colors.danger));
  await expect(body.getByText(ct.review.fieldEmptyRequired, { exact: true })).toHaveCount(1);
});

test("程式修改：檔案清單，PR 描述預設收起、點到其中的重點時展開，合併在 GitHub 進行", async ({ page }) => {
  const panel = await openWork(page, "j06");
  const body = panel.getByRole("article", { name: ct.review.deliverableCode });
  await expect(body.getByRole("list", { name: ct.review.codeFiles }).getByRole("listitem")).toHaveCount(2);
  await expect(body.getByText(ct.review.fileAdded, { exact: true })).toBeVisible();
  await expect(body.getByText(ct.review.mergeNote, { exact: true })).toBeVisible();
  await expect(body.locator("a")).toHaveCount(0);
  const details = body.locator("details");
  await expect(details).toHaveJSProperty("open", false);
  await expect(body.locator('[data-point~="2"]').first()).toBeHidden();
  await pointsCard(panel).getByRole("button").nth(1).click();
  await expect(details).toHaveJSProperty("open", true);
  await expect(body.locator('[data-point~="2"]').first()).toBeVisible();
  await expect(body.locator('[data-point~="2"]').first()).toHaveCSS("background-color", rgb(theme.colors.surfaceRaised));
});

test.describe("看重點（#102）：Linden 的 k13", () => {
  const label = (field: string) => demoLabel("k13", `kb/pre-orders#${field}`);
  const fieldName = (body: Locator, field: string) => body.locator("dt").filter({ hasText: label(field) });

  test("「為什麼是看重點」說明卡；有重點與空白的欄位照樣顯示，其他欄位可以展開與收回；變更收成一行可以逐項列出", async ({ page }) => {
    const panel = await openWork(page, "k13");
    const card = panel.getByRole("region", { name: ct.review.lightTitle });
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("border-top-color", rgb(theme.colors.success));
    await expect(card).toContainText(employeeName("linden"));

    const body = panel.getByRole("article", { name: ct.review.deliverableKb });
    for (const field of ["owner", "arrival", "effective-date"]) await expect(fieldName(body, field)).toBeVisible();
    await expect(body.getByText(ct.review.fieldEmptyRequired, { exact: true })).toBeVisible();
    const toggle = body.locator(".crew-collapsed__toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const field of ["payment", "cancellation"]) {
      await expect(toggle).toContainText(label(field));
      await expect(fieldName(body, field)).toBeHidden();
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText(ct.common.collapseFields);
    for (const field of ["payment", "cancellation"]) await expect(fieldName(body, field)).toBeVisible();
    await toggle.click();
    for (const field of ["payment", "cancellation"]) await expect(fieldName(body, field)).toBeHidden();

    const line = body.locator(".crew-review__changes-line");
    await expect(line).toContainText(demoChange("k13", 0));
    await expect(line).toContainText(demoChange("k13", 1));
    const items = body.locator(".crew-review__changes-items li");
    await expect(items.first()).toBeHidden();
    await line.getByRole("button", { name: ct.review.changesList, exact: true }).click();
    await expect(items).toHaveCount(2);
    await expect(items.first()).toBeVisible();
    await line.getByRole("button", { name: ct.review.changesHide, exact: true }).click();
    await expect(items.first()).toBeHidden();

    // 決定列不變
    await expect(panel.getByText(ct.review.decisionKb, { exact: true })).toBeVisible();
  });

  test("「看信任紀錄」切到信任頁", async ({ page }) => {
    const panel = await openWork(page, "k13");
    await panel.getByRole("button", { name: ct.review.lightTrust, exact: true }).click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionTrust, exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("逐項看的件（Rowan 的回信 s14）沒有說明卡，也沒有收起的欄位", async ({ page }) => {
    const panel = await openWork(page, "s14");
    await expect(panel.getByRole("region", { name: ct.review.lightTitle })).toHaveCount(0);
    await expect(panel.locator(".crew-collapsed, .crew-review__changes-collapsed")).toHaveCount(0);
  });

  for (const width of [1280, 390]) {
    test(`${width}px：展開後沒有水平捲動`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const panel = await openWork(page, "k13");
      await panel.locator(".crew-collapsed__toggle").click();
      await panel.getByRole("button", { name: ct.review.changesList, exact: true }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
