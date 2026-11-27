// 「信任」時間軸（#75，設計規格 v3 第 6.4 節）：四位員工 demo 開始時的狀態、staff 看到的文字，與手機 390 不破版。
// 最上方的總覽報表（#121）：欄位、點一列或退回的數字追到工作帳本並套用篩選、清除篩選，與三種身分、手機 390 的卡片。
// 每個 test 重新開頁，資料庫在瀏覽器記憶體中從 migration 與虛構資料重建。只在有 crew/demo.json 的客戶執行。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { access, language } from "./support/client";
import {
  assignmentTitle,
  crewContent,
  crewFill,
  crewSections,
  ct,
  employeeName,
  gotoCrewSection,
  hasCrewDemo,
  openCrew,
  trustRow,
  workTypeName,
} from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

async function openTrustAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionTrust);
}

// 圓點的清單（aria-label 是摘要，例如「通過 9、做錯了 1」）
const dots = (row: Locator) => row.getByRole("list").filter({ has: row.page().locator(".crew-trust__dot") });
// 「建議的經過」的每一步（#125）
const historySteps = (row: Locator) => row.getByRole("region", { name: ct.trust.historyTitle }).getByRole("listitem");
// 經手的身分名稱（client/access.json）
const roleName = (id: string) => access.roles.find((r) => r.id === id)!.label[language];
const badge = (level: string) => crewFill(ct.trust.levelBadge, { level });
const summary = (parts: [string, number][]) => parts.map(([key, count]) => crewFill(key, { count })).join(ct.trust.dotsAriaSeparator);

test.describe("信任：四種狀態（主管，桌機 1280）", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ page }) => openTrustAs(page, "manager"));

  test("頁首、圖例與規則說明", async ({ page }) => {
    // 子頁的主標題是頁首的 h1（#179）；原本當標題的 h2 改成一般文字
    await expect(page.getByRole("heading", { level: 1, name: ct.common.sectionTrust, exact: true })).toBeVisible();
    await expect(page.getByText(ct.trust.title, { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: ct.trust.legendLabel })).toContainText(ct.trust.legendWrong);
    await expect(page.getByText(ct.trust.rules, { exact: true })).toBeVisible();
    // 開頭的說明一行放得下，最後兩個字不再單獨換行（#106）
    const intro = page.locator(".crew-trust__heading p.muted");
    const lines = await intro.evaluate((p) => Math.round(p.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(p).lineHeight)));
    expect(lines).toBe(1);
  });

  test("Rowan：做錯了依規則自動改回，說明要重新累積，沒有按鈕", async ({ page }) => {
    const row = trustRow(page, "rowan", "support");
    await expect(row.locator(".crew-level-badge")).toHaveText(badge(ct.trust.levelItem));
    // #134：最近 10 次含 s16 的退回（其他退回）
    await expect(dots(row)).toHaveAttribute("aria-label", summary([[ct.trust.dotsAriaOk, 8], [ct.trust.dotsAriaWrong, 1], [ct.trust.dotsAriaNeutral, 1]]));
    await expect(row.getByText(crewFill(ct.trust.eventReset, { date: "10/15" }), { exact: false })).toBeVisible();
    await expect(row.getByText(ct.trust.noteReset, { exact: true })).toBeVisible();
    // 沒有同意或收回的按鈕（「建議的經過」裡打開那一件的按鈕不算，#125）
    await expect(row.getByRole("button", { name: ct.trust.agreeRelax, exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toHaveCount(0);
  });

  test("Sorrel：同意改看重點 → 事件「今天」與「收回，改回逐項看」→ 收回後說明下一份起改回逐項看", async ({ page }) => {
    const row = trustRow(page, "sorrel", "content");
    // 建議的經過跟著更新（#125）：提出 → 同意 → 收回
    await expect(historySteps(row)).toHaveCount(1);
    await row.getByRole("button", { name: ct.trust.agreeRelax, exact: true }).click();
    await expect(row.locator(".crew-level-badge")).toHaveText(badge(ct.trust.levelLight));
    await expect(row.getByText(crewFill(ct.trust.eventRelax, { date: ct.trust.today }), { exact: true })).toBeVisible();
    await expect(historySteps(row)).toHaveCount(2);
    await expect(historySteps(row).last()).toHaveText(crewFill(ct.trust.historyRelax, { date: ct.trust.today, actor: roleName("manager") }));
    await row.getByRole("button", { name: ct.trust.revoke, exact: true }).click();
    await expect(row.locator(".crew-level-badge")).toHaveText(badge(ct.trust.levelItem));
    await expect(row.getByText(ct.trust.noteRevoked, { exact: true })).toBeVisible();
    await expect(historySteps(row)).toHaveCount(3);
    await expect(historySteps(row).last()).toHaveText(crewFill(ct.trust.historyRevoke, { date: ct.trust.today, actor: roleName("manager") }));
  });

  test("Linden：看重點中，事件 10/13，有「收回，改回逐項看」", async ({ page }) => {
    const row = trustRow(page, "linden", "knowledge");
    await expect(row.locator(".crew-level-badge")).toHaveText(badge(ct.trust.levelLight));
    await expect(row.getByText(crewFill(ct.trust.eventRelax, { date: "10/13" }), { exact: true })).toBeVisible();
    await expect(row.getByText(ct.trust.noteLight, { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();
  });

  test("Rowan：建議的經過是提出 → 同意 → 生效 → 做錯了自動改回（#125）", async ({ page }) => {
    const steps = historySteps(trustRow(page, "rowan", "support"));
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toHaveText(crewFill(ct.trust.historyProposed, { date: "10/03", count: 10, from: "09/01", to: "10/03" }));
    await expect(steps.nth(1)).toHaveText(crewFill(ct.trust.historyRelax, { date: "10/09", actor: roleName("manager") }));
    // #161：同意後的第一次驗收是 s17（10/10）；做錯了的 s12 是同意後的第 5 件（抽查）
    await expect(steps.nth(2)).toContainText(crewFill(ct.trust.historyEffective, { date: "10/10" }));
    await expect(steps.nth(3)).toHaveText(crewFill(ct.trust.historyReset, { date: "10/15", title: assignmentTitle("s12") }));
  });

  test("Juniper：不用操作就有完整一輪：提出 → 同意 → 生效 → 收回；點生效的那件到「工作與驗收」（#125）", async ({ page }) => {
    const row = trustRow(page, "juniper", "dev");
    await expect(dots(row).getByRole("listitem")).toHaveCount(10);
    await expect(row.locator(".crew-level-badge")).toHaveText(badge(ct.trust.levelItem));
    // #161：同意與收回（改為 11/10）之間看重點驗收 5 次，兩個事件在不同的格
    const events = [crewFill(ct.trust.eventRelax, { date: "10/19" }), crewFill(ct.trust.eventRevoke, { date: "11/10" })].map((text) => row.getByText(text, { exact: true }));
    for (const event of events) await expect(event).toBeVisible();
    // 1280 時每個事件各自一行（不從「改回逐項看」的中間斷開，#131）
    for (const item of await row.locator(".crew-trust__event-item").all()) {
      expect(await item.evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)))).toBe(1);
    }
    await expect(row.getByText(ct.trust.noteRevoked, { exact: true })).toBeVisible();
    const steps = historySteps(row);
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toHaveText(crewFill(ct.trust.historyProposed, { date: "10/16", count: 10, from: "09/04", to: "10/16" }));
    await expect(steps.nth(1)).toHaveText(crewFill(ct.trust.historyRelax, { date: "10/19", actor: roleName("manager") }));
    await expect(steps.nth(2)).toContainText(crewFill(ct.trust.historyEffective, { date: "10/22" }));
    await expect(steps.nth(3)).toHaveText(crewFill(ct.trust.historyRevoke, { date: "11/10", actor: roleName("manager") }));
    // 沒有看重點的建議（收回後要重新累積），只有打開那一件的按鈕
    await expect(row.getByRole("button", { name: ct.trust.agreeRelax, exact: true })).toHaveCount(0);
    await steps.nth(2).getByRole("button", { name: crewFill(ct.trust.historyOpenWork, { title: assignmentTitle("j05") }), exact: true }).click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(crewContent(page).locator('[aria-current="true"]')).toContainText(assignmentTitle("j05"));
  });

  test("Sorrel：看重點的建議列出依據的 10 次驗收；「在工作帳本看這幾次」篩選成 Sorrel 的「貼文與商品介紹」（#125）", async ({ page }) => {
    const row = trustRow(page, "sorrel", "content");
    const summary = row.getByText(crewFill(ct.trust.basisSummary, { count: 10, from: "09/09", to: "10/27" }), { exact: true });
    await expect(summary).toBeVisible();
    await summary.click();
    const basis = row.getByRole("list", { name: ct.trust.basisLabel }).getByRole("listitem");
    await expect(basis).toHaveCount(10);
    await expect(basis.first()).toContainText(assignmentTitle("c02"));
    await expect(basis.last()).toContainText(assignmentTitle("c10"));
    await expect(historySteps(row)).toHaveCount(1);
    await expect(historySteps(row).first()).toHaveText(crewFill(ct.trust.historyProposed, { date: "10/21", count: 10, from: "09/04", to: "10/21" }));
    await row.getByRole("button", { name: ct.trust.basisOpenLedger, exact: true }).click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionLedger, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(activeFilter(page)).toContainText(employeeName("sorrel"));
    await expect(activeFilter(page)).toContainText(workTypeName("content"));
    await expect(ledgerRows(page).first()).toBeVisible();
    const n = await ledgerRows(page).count();
    for (let i = 0; i < n; i++) await expect(ledgerRows(page).nth(i)).toContainText(rowMeta("sorrel", "content"));
    for (const id of ["c10", "c09"]) await expect(ledgerRows(page).filter({ hasText: assignmentTitle(id) }).first()).toBeVisible();
    await expect(ledgerRows(page).filter({ hasText: ct.ledger.kindProposed })).toHaveCount(1);
  });
});

test("staff：看得到時間軸，沒有按鈕，說明只能查看", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTrustAs(page, "staff");
  const row = trustRow(page, "sorrel", "content");
  await expect(dots(row).getByRole("listitem")).toHaveCount(10);
  await expect(row.getByText(ct.trust.noteViewOnly, { exact: true })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  // 建議的經過照樣看得到（#125）；依據與「在工作帳本看這幾次」只跟著能同意的建議出現
  await expect(historySteps(row)).toHaveCount(1);
  await expect(row.getByRole("list", { name: ct.trust.basisLabel })).toHaveCount(0);
  await expect(historySteps(trustRow(page, "rowan", "support"))).toHaveCount(4);
  await expect(trustRow(page, "juniper", "dev")).toHaveCount(0);
});

test("手機 390：沒有水平捲動，時間軸在卡片內", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrustAs(page, "manager");
  const row = trustRow(page, "rowan", "support");
  await expect(dots(row).getByRole("listitem")).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const card = (await row.boundingBox())!;
  const list = (await dots(row).boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual(card.x + card.width);
  // 層級帶的名稱不截斷：兩格以上的換行顯示，一格的顯示短名（#106、#131）
  for (const band of await page.locator(".crew-trust__band").all()) {
    expect(await band.evaluate((b) => b.scrollWidth <= b.clientWidth && b.scrollHeight <= b.clientHeight)).toBe(true);
  }
  // 建議的經過與依據在卡片內（#125）
  for (const [employee, workType] of [["juniper", "dev"], ["sorrel", "content"]]) {
    const r = trustRow(page, employee, workType);
    const box = (await r.boundingBox())!;
    const history = (await r.getByRole("region", { name: ct.trust.historyTitle }).boundingBox())!;
    expect(history.x + history.width).toBeLessThanOrEqual(box.x + box.width);
  }
  await trustRow(page, "sorrel", "content").getByText(crewFill(ct.trust.basisSummary, { count: 10, from: "09/09", to: "10/27" }), { exact: true }).click();
  await expect(trustRow(page, "sorrel", "content").getByRole("list", { name: ct.trust.basisLabel })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// 一格的「看重點」顯示短名（#131）。#161 之後 demo 沒有一格的看重點（Juniper 看重點驗收了 5 次），
// 這裡讓 Sorrel 同意改看重點、再通過 c11，最後一格就是只有一格的看重點
test("手機 390：只有一格的「看重點」看得到短名，不是空框（#131）", async ({ page }) => {
  await openTrustAs(page, "manager");
  await trustRow(page, "sorrel", "content").getByRole("button", { name: ct.trust.agreeRelax, exact: true }).click();
  await expect(trustRow(page, "sorrel", "content").getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();
  await gotoCrewSection(page, ct.common.sectionWorks);
  const title = assignmentTitle("c11");
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = page.getByRole("article", { name: title });
  await panel.getByRole("button", { name: ct.review.accept, exact: true }).click();
  await expect(panel.getByRole("button", { name: ct.review.accept, exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCrewSection(page, ct.common.sectionTrust);
  const narrow = trustRow(page, "sorrel", "content").locator('.crew-trust__band[data-level="light"][data-span="1"]');
  await expect(narrow.locator(".crew-trust__band-short")).toBeVisible();
  await expect(narrow.locator(".crew-trust__band-short")).toHaveText(ct.trust.levelLightShort);
  await expect(narrow).toContainText(ct.trust.levelLight);
  expect(await narrow.evaluate((b) => b.scrollWidth <= b.clientWidth && b.scrollHeight <= b.clientHeight)).toBe(true);
});

// ---- 總覽報表（#121） ----
const report = (page: Page) => page.getByRole("table", { name: ct.trust.reportLabel });
const reportRows = (page: Page) => report(page).locator("tbody").getByRole("row");
const reportRow = (page: Page, employee: string, workType: string) =>
  report(page).locator(`tbody tr[data-employee="${employee}"][data-work-type="${workType}"]`);
const ledgerRows = (page: Page) => page.getByRole("table", { name: ct.ledger.listLabel }).locator("tbody").getByRole("row");
const rowMeta = (employee: string, workType: string) => crewFill(ct.ledger.eventMeta, { employee: employeeName(employee), workType: workTypeName(workType) });
// 工作帳本頂端的「目前的篩選」
const activeFilter = (page: Page) => crewContent(page).locator(".crew-ledger__active");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("總覽報表（主管，桌機 1280）", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ page }) => openTrustAs(page, "manager"));

  test("在時間軸上方；欄位與 Rowan 的數字（三種退回原因分開）", async ({ page }) => {
    const headers = [
      ct.trust.reportColumnRow,
      ct.trust.reportColumnReviews,
      ct.trust.reportColumnFirstPass,
      ct.trust.reportHeadWrong,
      ct.trust.reportHeadDifferent,
      ct.trust.reportHeadProcess,
      ct.trust.reportHeadSpot,
      ct.trust.reportHeadNotInPoints,
      ct.trust.reportColumnLevel,
      ct.trust.reportColumnChanges,
    ];
    // 退回原因的欄名前有圓點（做錯了是 ×），所以比對包含；表頭是短名，完整的名稱是無障礙名稱與 title（#131）
    await expect(report(page).locator("thead th")).toContainText(headers);
    await expect(report(page).locator("thead th")).toHaveCount(headers.length);
    for (const full of [ct.trust.reportColumnWrong, ct.trust.reportColumnDifferent, ct.trust.reportColumnProcess]) {
      await expect(report(page).getByRole("columnheader", { name: full, exact: true })).toHaveAttribute("title", full);
    }
    // 「第一次就通過」以交辦計：說明在報表上看得到，也是表頭的 title（#131）
    await expect(report(page).locator("xpath=ancestor::section[1]").getByText(ct.trust.reportFirstPassNote, { exact: true })).toBeVisible();
    await expect(report(page).getByRole("columnheader", { name: ct.trust.reportColumnFirstPass, exact: true })).toHaveAttribute("title", ct.trust.reportFirstPassNote);
    // 1280 時表頭不超過兩行，員工・工作類型欄不超過兩行（#131）
    const lines = (el: Locator) =>
      el.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const style = getComputedStyle(node as Element);
        const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
        return Math.round(range.getBoundingClientRect().height / line);
      });
    for (const th of await report(page).locator("thead th").all()) expect(await lines(th)).toBeLessThanOrEqual(2);
    for (const name of await report(page).locator("tbody th").all()) expect(await lines(name)).toBeLessThanOrEqual(2);
    await expect(reportRows(page)).toHaveCount(4);
    const reportBox = (await report(page).boundingBox())!;
    const firstCard = (await trustRow(page, "rowan", "support").boundingBox())!;
    expect(reportBox.y).toBeLessThan(firstCard.y);
    const rowan = reportRow(page, "rowan", "support");
    await expect(rowan.getByRole("cell")).toHaveText([
      // #134：s16 的退回（我想要不一樣的做法）加了一次驗收；#161 加了 s17～s20 四次通過
      "20",
      crewFill(ct.trust.reportFirstPass, { percent: 83, passed: 15, total: 18 }),
      "1",
      "2",
      "0",
      // #166：s12-1 是抽查時做錯了
      crewFill(ct.trust.reportSpot, { count: 1, wrong: 1 }),
      // #168：s12-1 退回時勾了「沒被標成重點」
      "1",
      ct.trust.levelItem,
      /.+/,
    ]);
    await expect(rowan).toContainText(crewFill(ct.trust.reportLastChange, { date: "10/15", change: ct.trust.reportChangeAutoReset }));
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("點一列 → 工作帳本篩選成該員工＋該工作類型；清除後回到全部", async ({ page }) => {
    await reportRow(page, "rowan", "support").getByRole("cell").first().click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionLedger, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(activeFilter(page)).toContainText(ct.ledger.activeFilter);
    await expect(activeFilter(page)).toContainText(employeeName("rowan"));
    await expect(activeFilter(page)).toContainText(workTypeName("support"));
    await expect(ledgerRows(page).first()).toBeVisible();
    const n = await ledgerRows(page).count();
    for (let i = 0; i < n; i++) await expect(ledgerRows(page).nth(i)).toContainText(rowMeta("rowan", "support"));
    await crewContent(page).getByRole("button", { name: ct.ledger.clearFilter, exact: true }).click();
    await expect(activeFilter(page)).toHaveCount(0);
    await expect(ledgerRows(page).filter({ hasNotText: rowMeta("rowan", "support") }).first()).toBeVisible();
  });

  test("點退回的數字 → 只看該員工＋該工作類型的退回，筆數與報表相同", async ({ page }) => {
    const sorrel = reportRow(page, "sorrel", "content");
    const wrong = sorrel.getByRole("cell").nth(2);
    const process = sorrel.getByRole("cell").nth(4);
    const total = Number(await wrong.innerText()) + Number(await process.innerText()) + Number(await sorrel.getByRole("cell").nth(3).innerText());
    await wrong.getByRole("button").click();
    await expect(activeFilter(page)).toContainText(ct.ledger.eventReturned);
    await expect(ledgerRows(page)).toHaveCount(total);
    for (let i = 0; i < total; i++) {
      await expect(ledgerRows(page).nth(i)).toHaveAttribute("data-kind", "returned");
      await expect(ledgerRows(page).nth(i)).toContainText(rowMeta("sorrel", "content"));
    }
  });
});

test("總覽報表：staff 只有自己專案的兩列", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTrustAs(page, "staff");
  await expect(reportRows(page)).toHaveCount(2);
  await expect(reportRow(page, "rowan", "support")).toBeVisible();
  await expect(reportRow(page, "sorrel", "content")).toBeVisible();
});

test("總覽報表：guest 是空狀態，沒有報表", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTrustAs(page, "guest");
  await expect(page.getByText(ct.trust.empty, { exact: true })).toBeVisible();
  await expect(report(page)).toHaveCount(0);
});

test("總覽報表：手機 390 每列一張卡片，沒有水平捲動；點卡片追到工作帳本", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrustAs(page, "manager");
  await expect(reportRows(page)).toHaveCount(4);
  expect(await noHorizontalScroll(page)).toBe(true);
  const table = (await report(page).boundingBox())!;
  for (const row of await reportRows(page).all()) {
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(table.x);
    expect(box.x + box.width).toBeLessThanOrEqual(table.x + table.width + 0.5);
  }
  await reportRow(page, "linden", "knowledge").getByRole("cell").first().click();
  await expect(ledgerRows(page).first()).toContainText(rowMeta("linden", "knowledge"));
  expect(await noHorizontalScroll(page)).toBe(true);
});
