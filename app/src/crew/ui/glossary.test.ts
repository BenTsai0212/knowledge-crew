import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { DEMO } from "../demo/load";
import { checkLabel, checkSentence, isCodePosition, positionLabel } from "./glossary";

const languages = [...clientConfig.client.languages];

describe("checkLabel／checkSentence", () => {
  it("檢查名稱換成白話", () => {
    expect(checkLabel("quote-match", "zh-TW")).toBe("報價核對");
    expect(checkLabel("required-fields", "en")).toBe("Required fields");
  });

  it("通過與未通過各有一句說明，檢查中沒有", () => {
    expect(checkSentence("ci", "pass", "zh-TW")).toBe("程式的測試與建置都通過");
    expect(checkSentence("ci", "fail", "zh-TW")).toBe("測試或建置失敗");
    expect(checkSentence("ci", "pending", "zh-TW")).toBeNull();
  });

  it("找不到對應時退回代碼（說明句為 null）", () => {
    expect(checkLabel("spellcheck", "zh-TW")).toBe("spellcheck");
    expect(checkSentence("spellcheck", "pass", "en")).toBeNull();
  });
});

describe("positionLabel", () => {
  it("reply/、post/ 依對照表", () => {
    expect(positionLabel("reply/p2", "zh-TW")).toBe("第 2 段");
    expect(positionLabel("post/image-alt", "zh-TW")).toBe("圖片說明");
    expect(positionLabel("reply/greeting", "en")).toBe("Opening greeting");
  });

  it("kb/<條目> 與 kb/<條目>#<欄位>", () => {
    expect(positionLabel("kb/pre-orders", "zh-TW")).toBe("「預購商品說明」");
    expect(positionLabel("kb/pre-orders#owner", "zh-TW")).toBe("「預購商品說明」的「負責部門」");
    expect(positionLabel("kb/warranty#steps", "zh-TW")).toBe("「保固申請」的「步驟」");
    expect(positionLabel("kb/shipping#fees", "en")).toBe("Shipping methods and fees: Shipping fees");
  });

  it("程式檔案路徑原樣回傳，並以等寬字顯示", () => {
    expect(positionLabel("app/src/index.ts", "zh-TW")).toBe("app/src/index.ts");
    expect(isCodePosition("app/src/index.ts")).toBe(true);
    expect(isCodePosition("reply/p2")).toBe(false);
    expect(isCodePosition("kb/pre-orders#owner")).toBe(false);
  });

  it("找不到對應時退回代碼", () => {
    expect(positionLabel("reply/p9", "zh-TW")).toBe("reply/p9");
    expect(positionLabel("kb/unknown", "zh-TW")).toBe("kb/unknown");
    expect(positionLabel("kb/pre-orders#unknown", "en")).toBe("kb/pre-orders#unknown");
    expect(positionLabel("kb/", "zh-TW")).toBe("kb/");
    expect(positionLabel("/reply", "zh-TW")).toBe("/reply");
  });
});

// demo.json 中每個 checks[].name 與 changes[].path（不論在哪一層）
function collect(node: unknown, names: Set<string>, paths: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => collect(n, names, paths));
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "checks" && Array.isArray(value)) for (const c of value) names.add((c as { name: string }).name);
    if (key === "changes" && Array.isArray(value)) for (const c of value) paths.add((c as { path: string }).path);
    collect(value, names, paths);
  }
}

describe("完整性：demo.json 的代碼在每種語言都有白話", () => {
  const names = new Set<string>();
  const paths = new Set<string>();
  collect(DEMO, names, paths);

  it("參考情境有檢查名稱與 reply/、post/、kb/ 位置", () => {
    expect(names.size).toBeGreaterThan(0);
    expect([...paths].filter((p) => !isCodePosition(p)).length).toBeGreaterThan(0);
  });

  it.each(languages)("%s", (language) => {
    for (const name of names) {
      expect(checkLabel(name, language), name).not.toBe(name);
      expect(checkSentence(name, "pass", language), name).not.toBeNull();
      expect(checkSentence(name, "fail", language), name).not.toBeNull();
    }
    for (const path of paths) if (!isCodePosition(path)) expect(positionLabel(path, language), path).not.toBe(path);
  });
});
