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
const firstFieldText = (body: string) =>
  body
    .split("\n")
    .find((line) => line.trim() !== "" && !line.startsWith("@@"))!
    .replace(/\u3014\/?\d+\u3015/g, "")
    .trim();

async function expectLevel(page: Page, employee: string, workType: string, expected: string): Promise<void> {
  await expect(trustRow(page, employee, workType).getByText(expected, { exact: true })).toBeVisible();
}

test("交辦 → 模擬交件 → 退回（做錯了）→ 信任改回逐項看 → 工作帳本記下四筆", async ({ page }) => {
  // 開始前：Linden 的「知識庫整理」是少看，有「收回」
  await gotoCrewSection(page, ct.common.sectionTrust);
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
      const checks = panel.getByRole("heading", { name: ct.review.checks, exact: true });
      const body = panel.getByRole("article", { name: ct.review.deliverableKb });
      await expect(points).toBeVisible();
      await expect(checks).toBeVisible();
      await expect(body).toBeVisible();
      // 重點與自動檢查在交件本身之上（#72）；交件依區塊呈現，第一個有內容的欄位直接看得到
      const bodyTop = (await body.boundingBox())!.y;
      expect((await points.boundingBox())!.y).toBeLessThan(bodyTop);
      expect((await checks.boundingBox())!.y).toBeLessThan(bodyTop);
      await expect(body.getByText(firstFieldText(firstReplyBody("linden", "knowledge")), { exact: true })).toBeVisible();
    },
  });

  // 5：最後一個圓點是做錯了，層級改回逐項看，「收回」消失
  await gotoCrewSection(page, ct.common.sectionTrust);
  const row = trustRow(page, "linden", "knowledge");
  await expect(row.getByRole("listitem").last()).toHaveAttribute("aria-label", ct.trust.dotWrong);
  await expectLevel(page, "linden", "knowledge", ct.trust.levelItem);
  await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toHaveCount(0);

  // 6：最新的四筆是交辦、交件、退回（做錯了）與改回逐項看（同一時間的先後不斷言）
  await gotoCrewSection(page, ct.common.sectionLedger);
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

test("對照：退回選「我想要不一樣的做法」時，Linden 的「知識庫整理」維持少看", async ({ page }) => {
  await assignSimulateReturn(page, { title: TITLE, employee: "linden", workType: "knowledge", reason: ct.review.reasonDifferentApproach });
  await gotoCrewSection(page, ct.common.sectionTrust);
  await expect(trustRow(page, "linden", "knowledge").getByRole("listitem").last()).toHaveAttribute("aria-label", ct.trust.dotNeutral);
  await expectLevel(page, "linden", "knowledge", ct.trust.levelLight);
  await expect(trustRow(page, "linden", "knowledge").getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();
});

test("對照：Sorrel 的「貼文與商品介紹」同意少看 → 少看、出現「收回」→ 收回 → 逐項看（建議要重新累積，不馬上再出現）", async ({ page }) => {
  await gotoCrewSection(page, ct.common.sectionTrust);
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
