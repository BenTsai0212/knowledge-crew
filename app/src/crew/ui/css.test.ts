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
