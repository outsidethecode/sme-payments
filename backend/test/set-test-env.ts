/**
 * Loaded before each test file via Jest `setupFiles`.
 * Ensures every NestJS test app connects to the test database,
 * NOT the dev database.
 */
process.env.DATABASE_URL =
  "postgresql://sme_user:sme_password@localhost:5433/sme_payments_test";

// Disable the auto-anchor scheduler during tests
process.env.ANCHOR_PROVIDER = "noop";
process.env.ANCHOR_INTERVAL_MINUTES = "0";
