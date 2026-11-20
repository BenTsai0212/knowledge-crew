// crew 的 migration（ADR 0004）：版本加上 crew/ 前綴，與 knowledge-kit 共用 kk_meta.schema_migrations 與 checksum。
// 由 openDatabase() 的 migrations 選項以 kk_owner 套用；已合併的 crew migration 不可修改（AGENTS.md 第 5 節）。
import type { Migration } from "../../db/migrate";

const files = import.meta.glob<string>("./migrations/*.sql", { query: "?raw", import: "default", eager: true });

export const crewMigrations: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ version: `crew/${path.replace(/^.*\//, "").replace(/\.sql$/, "")}`, sql }))
  .sort((a, b) => a.version.localeCompare(b.version));
