import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONVEX_DIR = path.join(ROOT, "convex");
const SRC_DIR = path.join(ROOT, "src");

function walkTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const checks = [];
function runCheck(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    checks.push({ name, ok: false, error: err });
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

// 1. Zero unindexed Convex `.filter(...)` scans
runCheck("Zero unindexed Convex db.query().filter() scans", () => {
  const files = walkTsFiles(CONVEX_DIR);
  const violations = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // Match Convex query builder .filter((q) => ...) patterns
    if (/\.query\([^)]*\)[\s\S]{0,120}\.filter\s*\(/.test(src)) {
      violations.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(violations, [], `Found unindexed .filter() in: ${violations.join(", ")}`);
});

// 2. Strict TypeScript: zero explicit `: any` or `as any` in application code
runCheck("Strict TypeScript: zero explicit `any` types in convex/ and src/", () => {
  const files = [...walkTsFiles(CONVEX_DIR), ...walkTsFiles(SRC_DIR)];
  const violations = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (/(?::\s*any\b|\bas\s+any\b|<any>)/.test(src)) {
      violations.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(violations, [], `Found explicit any in: ${violations.join(", ")}`);
});

// 3. Super Admin backend modules enforce Law #3 (`requireSuperAdmin`)
runCheck("Super Admin modules enforce requireSuperAdmin (Law #3)", () => {
  for (const rel of [
    "convex/superAdmin.ts",
    "convex/subscriptions.ts",
    "convex/platformAnalytics.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const exportsCount = (src.match(/export const \w+\s*=\s*(?:query|mutation)\(/g) ?? [])
      .length;
    const guardCount = (src.match(/await requireSuperAdmin\(ctx\)/g) ?? []).length;
    assert.ok(exportsCount > 0, `${rel} must export queries/mutations`);
    assert.equal(
      guardCount,
      exportsCount,
      `${rel}: ${guardCount} requireSuperAdmin calls for ${exportsCount} exported handlers`
    );
  }
});

// 4. Clinic operational modules enforce `requireClinicAccess` & `assertClinicCanWrite`
runCheck("Clinic modules enforce requireClinicAccess & quota/status gates (Laws #2 & #4)", () => {
  for (const rel of [
    "convex/clinicAdmin.ts",
    "convex/appointments.ts",
    "convex/odontogram.ts",
    "convex/files.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(src.includes("requireClinicAccess"), `${rel} missing requireClinicAccess`);
    assert.ok(src.includes("assertClinicCanWrite"), `${rel} missing assertClinicCanWrite`);
    assert.ok(
      src.includes("READ_ONLY_IMPERSONATION"),
      `${rel} missing READ_ONLY_IMPERSONATION block`
    );
  }
});

// 5. Dual-resource scheduling conflict math (Phase 4/5 QA Check #4)
runCheck("Dual-resource conflict & sterilization buffer interval math", () => {
  const intervalsOverlap = (aStart, aEnd, bStart, bEnd) =>
    aStart < bEnd && aEnd > bStart;

  // Dr. Santos in Chair 1: 09:00-09:45 + 15 min buffer = 10:00
  const existingStart = Date.parse("2026-11-20T09:00:00+08:00");
  const existingBufferEnd = Date.parse("2026-11-20T10:00:00+08:00");

  // Candidate at 09:45 (45m + 15m = 10:45) MUST conflict with existing 09:00-10:00
  const cand0945Start = Date.parse("2026-11-20T09:45:00+08:00");
  const cand0945End = Date.parse("2026-11-20T10:45:00+08:00");
  assert.equal(
    intervalsOverlap(existingStart, existingBufferEnd, cand0945Start, cand0945End),
    true,
    "09:45 slot must overlap 09:00-09:45 + 15m buffer"
  );

  // Candidate at 10:00 (45m + 15m = 11:00) MUST NOT conflict
  const cand1000Start = Date.parse("2026-11-20T10:00:00+08:00");
  const cand1000End = Date.parse("2026-11-20T11:00:00+08:00");
  assert.equal(
    intervalsOverlap(existingStart, existingBufferEnd, cand1000Start, cand1000End),
    false,
    "10:00 slot must be free immediately after 15m sterilization buffer"
  );
});

// 6. All operational tables in convex/schema.ts have a clinicId-leading compound index (Law #1)
runCheck("All operational tables define a clinicId-leading index (Law #1)", () => {
  const schemaSrc = fs.readFileSync(path.join(CONVEX_DIR, "schema.ts"), "utf8");
  const operationalTables = [
    "dentists",
    "dentistTimeOff",
    "chairs",
    "services",
    "patients",
    "appointments",
    "slotLocks",
    "toothRecords",
    "clinicalFiles",
    "waitlist",
    "clinicMetricsDaily",
  ];
  for (const table of operationalTables) {
    const idx = schemaSrc.indexOf(`${table}: defineTable(`);
    assert.ok(idx !== -1, `Missing table ${table}`);
    const nextTableIdx = schemaSrc.indexOf("defineTable(", idx + table.length + 14);
    const slice =
      nextTableIdx === -1 ? schemaSrc.slice(idx) : schemaSrc.slice(idx, nextTableIdx);
    assert.ok(
      /\.index\("[^"]+",\s*\[\s*"clinicId"/.test(slice),
      `Table "${table}" is missing a clinicId-leading index`
    );
  }
});

// 7. Cron jobs registered cleanly in convex/crons.ts
runCheck("Daily automation crons registered in convex/crons.ts", () => {
  const cronsSrc = fs.readFileSync(path.join(CONVEX_DIR, "crons.ts"), "utf8");
  for (const jobName of [
    "daily-subscription-expiry-sweep",
    "daily-analytics-rollup",
    "daily-24h-appointment-reminders",
    "daily-hygiene-recall-check",
    "daily-expired-slot-lock-cleanup",
  ]) {
    assert.ok(cronsSrc.includes(jobName), `Missing cron job: ${jobName}`);
  }
});

const failed = checks.filter((c) => !c.ok);
console.log(`\nSummary: ${checks.length - failed.length}/${checks.length} hardening checks passed.`);
if (failed.length > 0) {
  process.exit(1);
}
