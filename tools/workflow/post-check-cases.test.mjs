// 貼出前檢查的共用測試案例（#111）：本工具與 app/src/crew/github/post-check.ts 讀同一份案例，結果必須相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSensitiveContent } from './check-post-body.mjs';
import { scanText } from './check-sensitive.mjs';

const CASES_FILE = new URL('./testdata/post-check-cases.json', import.meta.url);
const KIND = { email: 'email', 個人路徑: 'personalPath', 禁用名稱: 'deniedName' };

/** 案例的佔位換回實際的字元（本檔與案例檔都在 repo 的掃描範圍內，不寫出完整的 email 與路徑）。 */
const expand = (text) => text.replaceAll('{AT}', '@').replaceAll('{USERS}', `/${'Users'}`).replaceAll('{HOME}', `/${'home'}`);

const { cases } = JSON.parse(readFileSync(CASES_FILE, 'utf8'));

test('共用案例：至少涵蓋 email、個人路徑與禁用名稱', () => {
  const kinds = new Set(cases.flatMap((c) => c.expect.map((e) => e.kind)));
  assert.deepEqual([...kinds].sort(), ['deniedName', 'email', 'personalPath']);
  assert.ok(cases.some((c) => c.expect.length === 0));
});

for (const c of cases) {
  test(`共用案例：${c.name}`, () => {
    const text = expand(c.text);
    assert.deepEqual(scanText(text, c.names).map((f) => ({ line: f.line, kind: KIND[f.kind] })), c.expect);
    // check-post-body.mjs 用同一套規則，只輸出行號與種類
    assert.equal(checkSensitiveContent(text, c.names).length, c.expect.length);
  });
}
