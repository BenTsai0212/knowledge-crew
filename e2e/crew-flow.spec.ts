// crew 的門檻流程（#53，#15 計畫第 7、8 節的 L；Epic #9 的門檻）：交辦 → 模擬交件 → 驗收退回 → 信任變化 → 工作帳本，與兩個對照。
// 每個 test 重新開頁，資料庫在瀏覽器記憶體中從 migration 與虛構資料重建。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { assignSimulateReturn, crewFill, ct, firstReplyBody, gotoCrewSection, hasCrewDemo, openCrew, trustRow } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");
test.use({ viewport: { width: 1440, height: 900 } });

// 交辦的一句話（使用者輸入的內容，不是介面文字）；每個 test 的資料庫各自重建，不會互相影響
const TITLE = "E2E：整理退換貨的知識庫條目";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
});

// 交件全文中第一個有內容的行（不是 @@ 標頭行），去掉重點標記 〔N〕〔/N〕
// 第一個有重點標記（〔N〕）的欄位內容：看重點時沒標重點的欄位收起（#102），有重點的欄位照樣顯示
const firstMarkedText = (body: string) =>
  body
    .split("\n")
    .find((line) => !line.startsWith("@@") && /\u3014\d+\u3015/.test(line))!
    .replace(/\u3014\/?\d+\u3015/g, "")
    .trim();

// 層級徽章（#75：時間軸的層級帶也有「逐項看／看重點」，所以只看徽章；#186 起徽章只寫「全部看」「只看標記處」，以 .crew-level-badge 指定）
async function expectLevel(page: Page, employee: string, workType: string, expected: string): Promise<void> {
  await expect(trustRow(page, employee, workType).locator(".crew-level-badge")).toHaveText(crewFill(ct.trust.levelBadge, { level: expected }));
}

test("交辦 → 模擬交件 → 退回（做錯了）→ 員工頁的審查方式改回全部看 → 紀錄記下四筆", async ({ page }) => {
  // 開始前：Linden 的「知識庫整理」是看重點，有「收回」
  await gotoCrewSection(page, ct.common.sectionEmployees);
  await expectLevel(page, "linden", "knowledge", ct.trust.levelLight);
  await expect(trustRow(page, "linden", "knowledge").getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();

  // 1～4：交辦、模擬交件、選這一筆，退回並選「做錯了」；第 3 步的面板在退回之前檢查
  await assignSimulateReturn(page, {
    title: TITLE,
    employee: "linden",
    workType: "knowledge",
    reason: ct.review.reasonWrong,
    beforeReturn: async (panel) => {
      const points = panel.getByRole("heading", { name: ct.review.points, exact: true });
      const checks = panel.getByRole("heading", { level: 5, name: ct.review.checks, exact: true });
      const body = panel.getByRole("article", { name: ct.review.deliverableKb });
      await expect(points).toBeVisible();
      await expect(checks).toBeVisible();
      await expect(body).toBeVisible();
      // 重點與自動檢查在交件本身之上（#72）；交件依區塊呈現，有重點的欄位直接看得到，沒標重點的欄位收起（看重點，#102）
      const bodyTop = (await body.boundingBox())!.y;
      expect((await points.boundingBox())!.y).toBeLessThan(bodyTop);
      expect((await checks.boundingBox())!.y).toBeLessThan(bodyTop);
      const marked = body.locator(".crew-review__mark").first();
      await expect(marked).toBeVisible();
      await expect(marked).toContainText(firstMarkedText(firstReplyBody("linden", "knowledge")));
      await expect(body.locator(".crew-collapsed__toggle")).toHaveAttribute("aria-expanded", "false");
    },
  });

  // 5：最後一個圓點是做錯了，層級改回逐項看，「收回」消失
  await gotoCrewSection(page, ct.common.sectionEmployees);
  const row = trustRow(page, "linden", "knowledge");
  // 圓點的清單（卡片內還有「建議的經過」的清單，#125）
  await expect(row.locator(".crew-trust__dots").getByRole("listitem").last()).toHaveAttribute(
    "aria-label",
    crewFill(ct.trust.dotCell, { result: ct.trust.dotWrong, date: ct.trust.today }),
  );
  await expectLevel(page, "linden", "knowledge", ct.trust.levelItem);
  await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toHaveCount(0);

  // 6：最新的四筆是交辦、交件、退回（做錯了）與改回逐項看（同一時間的先後不斷言）
  await gotoCrewSection(page, ct.common.sectionRecords);
  const items = page.getByRole("table", { name: ct.ledger.listLabel }).locator("tbody").getByRole("row");
  await expect(items.first()).toBeVisible();
  const kinds = [
    ct.ledger.kindAssigned,
    crewFill(ct.ledger.kindSubmitted, { round: 1 }),
    crewFill(ct.ledger.kindReturned, { reason: ct.ledger.reasonWrong }),
    ct.ledger.kindAutoReset,
  ];
  const found: string[] = [];
  for (let i = 0; i < kinds.length; i++) {
    for (const kind of kinds) if ((await items.nth(i).getByText(kind, { exact: true }).count()) > 0) found.push(kind);
  }
  expect(found.sort()).toEqual([...kinds].sort());
  for (let i = 0; i < kinds.length; i++) {
    if ((await items.nth(i).getByText(ct.ledger.kindAutoReset, { exact: true }).count()) === 0) await expect(items.nth(i)).toContainText(TITLE);
  }
});

test("對照：退回選「我想要不一樣的做法」時，Linden 的「知識庫整理」維持看重點", async ({ page }) => {
  await assignSimulateReturn(page, { title: TITLE, employee: "linden", workType: "knowledge", reason: ct.review.reasonDifferentApproach });
  await gotoCrewSection(page, ct.common.sectionEmployees);
  await expect(trustRow(page, "linden", "knowledge").locator(".crew-trust__dots").getByRole("listitem").last()).toHaveAttribute(
    "aria-label",
    crewFill(ct.trust.dotCell, { result: ct.trust.dotNeutral, date: ct.trust.today }),
  );
  await expectLevel(page, "linden", "knowledge", ct.trust.levelLight);
  await expect(trustRow(page, "linden", "knowledge").getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();
});

test("對照：Sorrel 的「貼文與商品介紹」同意改看重點 → 看重點、出現「收回」→ 收回 → 逐項看（建議要重新累積，不馬上再出現）", async ({ page }) => {
  await gotoCrewSection(page, ct.common.sectionEmployees);
  const row = trustRow(page, "sorrel", "content");
  const agree = row.getByRole("button", { name: ct.trust.agreeRelax, exact: true });
  const revoke = row.getByRole("button", { name: ct.trust.revoke, exact: true });
  await expectLevel(page, "sorrel", "content", ct.trust.levelItem);
  await expect(agree).toBeVisible();

  await agree.click();
  await expectLevel(page, "sorrel", "content", ct.trust.levelLight);
  await expect(revoke).toBeVisible();
  await expect(agree).toHaveCount(0);

  await revoke.click();
  await expectLevel(page, "sorrel", "content", ct.trust.levelItem);
  await expect(revoke).toHaveCount(0);
  // 收回後從收回之後重新累積（app/src/crew/trust/rules.ts 的 relaxSuggestion，rules.test.ts「revoke 後回到 item，並從 revoke 之後重新累積」），
  // 所以建議不會馬上再出現。依 #53 的 `## 決定` 採用這條規則
  await expect(agree).toHaveCount(0);
});
