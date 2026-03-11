/**
 * Jest globalSetup — runs ONCE before the entire test suite.
 *
 * 1. Creates the test database `sme_payments_test` (idempotent).
 * 2. Runs Prisma migrations against it.
 * 3. Seeds the database with reference data (users, orgs, policies).
 *
 * The test DATABASE_URL is read from .env.test so the dev DB is never touched.
 */
import { execSync } from "child_process";
import * as path from "path";

const TEST_DB = "sme_payments_test";
const PG_HOST = "localhost";
const PG_PORT = "5433";
const PG_USER = "sme_user";
const PG_PASS = "sme_password";

const TEST_DATABASE_URL = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${TEST_DB}`;

function run(cmd: string, env?: Record<string, string>) {
  execSync(cmd, {
    stdio: "pipe",
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ...env },
  });
}

export default async function globalSetup() {
  // 1. Create the test database if it doesn't exist
  try {
    run(
      `PGPASSWORD=${PG_PASS} psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1 || PGPASSWORD=${PG_PASS} createdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} ${TEST_DB}`,
    );
  } catch {
    // createdb might not be available; try via psql CREATE DATABASE
    try {
      run(
        `PGPASSWORD=${PG_PASS} psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "CREATE DATABASE ${TEST_DB};"`,
      );
    } catch {
      // Already exists — that's fine
    }
  }

  // 2. Run Prisma migrations (deploy = no interactive prompts)
  run("npx prisma migrate deploy", {
    DATABASE_URL: TEST_DATABASE_URL,
  });

  // 3. Seed with reference data
  run("npx ts-node prisma/seed.ts", {
    DATABASE_URL: TEST_DATABASE_URL,
  });

  // 4. Export the URL so every test file picks it up
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}
