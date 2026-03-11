/**
 * Jest globalTeardown — runs ONCE after the entire test suite finishes.
 *
 * Drops the test database so stale data never accumulates.
 */
import { execSync } from "child_process";

const TEST_DB = "sme_payments_test";
const PG_HOST = "localhost";
const PG_PORT = "5433";
const PG_USER = "sme_user";
const PG_PASS = "sme_password";

export default async function globalTeardown() {
  try {
    // Terminate active connections before dropping
    execSync(
      `PGPASSWORD=${PG_PASS} psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB}' AND pid <> pg_backend_pid();"`,
      { stdio: "pipe" },
    );
    execSync(
      `PGPASSWORD=${PG_PASS} psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};"`,
      { stdio: "pipe" },
    );
  } catch (err) {
    console.warn(`[globalTeardown] Could not drop ${TEST_DB}:`, err);
  }
}
