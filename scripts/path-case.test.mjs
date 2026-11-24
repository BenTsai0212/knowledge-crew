import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 不分大小寫的檔案系統（macOS 預設）上，只差大小寫的兩個檔案會互相蓋掉；
// 沒有副檔名的 import（例如 "./Tour"）也會解析到另一個檔案（knowledge-crew #127：Tour.tsx 與 tour.ts）。
// CI 在分大小寫的 Linux 上執行攔不到，所以檢查 git 追蹤的路徑。
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 去掉最後一個副檔名（`Tour.tsx` → `Tour`、`sidebar.test.ts` → `sidebar.test`；`.gitignore` 不算副檔名）。 */
function stem(path) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return path.slice(0, slash + 1) + (dot <= 0 ? name : name.slice(0, dot));
}

/** 檔案與它所在的每一層資料夾（資料夾只差大小寫時同樣會合併）。 */
function withDirs(paths) {
  const all = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("/"));
  }
  return [...all];
}

/** 互相衝突的路徑組：去掉副檔名、轉成小寫後相同，但原本的寫法不同。 */
export function caseCollisions(paths) {
  const groups = new Map();
  for (const path of withDirs(paths)) {
    const key = stem(path).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()].filter((group) => new Set(group.map(stem)).size > 1).map((group) => [...group].sort());
}

describe("只差大小寫的路徑（#127）", () => {
  it("找出去掉副檔名、轉成小寫後相同的路徑", () => {
    expect(caseCollisions(["app/ui/Tour.tsx", "app/ui/tour.ts", "app/ui/Tour.css"])).toEqual([["app/ui/Tour.css", "app/ui/Tour.tsx", "app/ui/tour.ts"]]);
    expect(caseCollisions(["a/README.md", "a/readme.txt"])).toEqual([["a/README.md", "a/readme.txt"]]);
    expect(caseCollisions(["App/x.ts", "app/y.ts"])).toEqual([["App", "app"]]);
    expect(caseCollisions(["a/Makefile", "a/makefile"])).toEqual([["a/Makefile", "a/makefile"]]);
  });

  it("同名不同副檔名、寫法相同的不算衝突", () => {
    expect(caseCollisions(["ui/Tour.tsx", "ui/Tour.css", "ui/tour-steps.ts", "ui/tour-steps.test.ts", "ui/.gitignore"])).toEqual([]);
    expect(caseCollisions(["a/x.ts", "b/X.ts"])).toEqual([]);
    expect(caseCollisions(["ui/Sidebar.tsx", "ui/sidebar.test.ts"])).toEqual([]);
  });

  it("git 追蹤的檔案沒有只差大小寫的路徑", () => {
    const paths = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
    expect(paths.length).toBeGreaterThan(100);
    const found = caseCollisions(paths);
    expect(found, `只差大小寫的路徑（在 macOS 等不分大小寫的檔案系統上會互相蓋掉，把其中一個改名）：\n${found.map((g) => g.join("、")).join("\n")}`).toEqual([]);
  });
});
