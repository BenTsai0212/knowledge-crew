// 結構測試：crew 每個畫面的 CSS（app/src/crew/ui/*.css）與 app.css 一樣不寫死顏色值，theme 變數只用 theme.json 有的（#34）。
// vitest.config.ts 的 css.include 納入 app/src/crew/ui/*.css，?raw 才讀得到原文。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { themeVariables } from "../../ui/theme";

const files = import.meta.glob<string>("./*.css", { query: "?raw", import: "default", eager: true });
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// 與 app/src/ui/theme.test.ts 相同的寫死顏色值與色名
const COLOR_VALUE = /#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const COLOR_NAMES = /:\s*[^;{}]*\b(?:white|black|red|green|blue|yellow|orange|purple|pink|brown|gray|grey|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|cyan|magenta)\b/i;

describe("crew 的 CSS", () => {
  const entries = Object.entries(files);

  it("讀得到原文（css.include 有納入）", () => {
    expect(entries.map(([p]) => p)).toContain("./CrewPage.css");
    for (const [path, css] of entries) expect(css.trim(), path).not.toBe("");
  });

  it("沒有寫死的顏色值或色名", () => {
    for (const [path, css] of entries) {
      expect(strip(css), path).not.toMatch(COLOR_VALUE);
      expect(strip(css), path).not.toMatch(COLOR_NAMES);
    }
  });

  it("用到的 --color-*、--radius-*、--font-* 都由 theme.json 提供", () => {
    const provided = new Set(Object.keys(themeVariables(clientConfig.theme)));
    for (const [path, css] of entries) {
      const used = [...strip(css).matchAll(/var\((--(?:color|radius|font)-[\w-]+)\)/g)].map((m) => m[1]);
      expect(used.filter((v) => !provided.has(v)), path).toEqual([]);
    }
  });
});

// #153 第 3 點（WCAG 1.4.11）：crew 頁內輸入框、下拉選單、多行輸入的邊框改用 textMuted，Light／Dark 對表單底色（surface）與頁面底色都 ≥ 3:1
describe("crew 頁表單元件的邊框", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("CrewPage.css 在 .crew-page 之下改用 var(--color-textMuted)（不含核取方塊與單選鈕）", () => {
    const css = strip(files["./CrewPage.css"]);
    expect(css).toMatch(/\.crew-page input:not\(\[type="checkbox"\], \[type="radio"\]\),\s*\.crew-page select,\s*\.crew-page textarea\s*\{\s*border-color: var\(--color-textMuted\);/);
  });

  it("Light、Dark 的 textMuted 對 surface、background、surfaceRaised 都 ≥ 3:1", () => {
    for (const [scheme, colors] of [["light", clientConfig.theme.colors], ["dark", clientConfig.theme.darkColors]] as const) {
      for (const behind of ["surface", "background", "surfaceRaised"] as const) {
        expect(contrast(colors.textMuted, colors[behind]), `${scheme} ${behind}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
