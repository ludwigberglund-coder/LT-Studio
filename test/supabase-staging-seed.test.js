import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const seedPath = new URL("../supabase/seeds/staging_synthetic_tenants.sql", import.meta.url);
const seed = fs.readFileSync(seedPath, "utf8");

test("Supabase staging seed contains two clearly synthetic isolated tenants", () => {
  assert.match(seed, /'staging-alpha'/);
  assert.match(seed, /'staging-beta'/);
  assert.match(seed, /Synthetic Alpha/);
  assert.match(seed, /Synthetic Beta/);
  assert.match(seed, /example\.invalid/);
  assert.match(seed, /EJ-BETALNING/);
});

test("Supabase staging seed stays separate from shared UAT automatic seed", () => {
  const config = fs.readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /sql_paths\s*=\s*\["\.\/seeds\/uat_shared_registers\.sql"\]/);
  assert.doesNotMatch(config, /staging_synthetic_tenants\.sql/);
});

test("Supabase staging seed does not contain known real/pilot identity labels", () => {
  assert.doesNotMatch(seed, /Rolands/i);
  assert.doesNotMatch(seed, /LT Studio UAT AB/i);
  assert.doesNotMatch(seed, /ludwigberglund@/i);
});
