/**
 * Phase 5 — Stress Test Orchestrator
 *
 * Runs scenario-runner scenarios at scale with configurable concurrency,
 * iteration counts, chaos mode, and detailed reporting.
 *
 * Usage:
 *   npx ts-node test/stress/run-stress.ts [options]
 *
 * Options:
 *   --scenarios=all|1,2,3    Which scenarios to run (default: all)
 *   --count=100              Iterations per scenario (default: 10)
 *   --concurrency=5          Parallel workers (default: 3)
 *   --chaos                  Inject random delays
 *   --bail                   Stop on first failure
 *   --quiet                  Suppress per-iteration output
 */

import {
  scenarios,
  runScenario,
  loginAdmin,
  type ScenarioResult,
} from "./scenario-runner";

// ═══════════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════════

interface StressConfig {
  scenarioIds: number[];
  count: number;
  concurrency: number;
  chaos: boolean;
  bail: boolean;
  quiet: boolean;
}

function parseArgs(): StressConfig {
  const args = process.argv.slice(2);

  const scenariosArg = args.find((a) => a.startsWith("--scenarios="));
  let scenarioIds: number[];
  if (!scenariosArg || scenariosArg.split("=")[1] === "all") {
    scenarioIds = scenarios.map((s) => s.id);
  } else {
    scenarioIds = scenariosArg
      .split("=")[1]
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n));
  }

  const countArg = args.find((a) => a.startsWith("--count="));
  const count = countArg ? parseInt(countArg.split("=")[1]) : 10;

  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg
    ? parseInt(concurrencyArg.split("=")[1])
    : 3;

  const chaos = args.includes("--chaos");
  const bail = args.includes("--bail");
  const quiet = args.includes("--quiet");

  return { scenarioIds, count, concurrency, chaos, bail, quiet };
}

// ═══════════════════════════════════════════════════════════════════
// Worker Pool
// ═══════════════════════════════════════════════════════════════════

interface WorkItem {
  scenarioId: number;
  iteration: number;
}

interface StressReport {
  totalRuns: number;
  passed: number;
  failed: number;
  errors: { scenarioId: number; iteration: number; error: string }[];
  timings: Map<number, number[]>; // scenario → [durationMs, ...]
  startTime: number;
  endTime: number;
}

async function runWorkerPool(
  config: StressConfig,
  admin: { accessToken: string; id: string; role: string },
): Promise<StressReport> {
  const report: StressReport = {
    totalRuns: 0,
    passed: 0,
    failed: 0,
    errors: [],
    timings: new Map(),
    startTime: performance.now(),
    endTime: 0,
  };

  // Build work queue
  const queue: WorkItem[] = [];
  for (const scenarioId of config.scenarioIds) {
    report.timings.set(scenarioId, []);
    for (let i = 1; i <= config.count; i++) {
      queue.push({ scenarioId, iteration: i });
    }
  }

  let queueIndex = 0;
  let bailOut = false;

  async function worker(workerId: number): Promise<void> {
    while (queueIndex < queue.length && !bailOut) {
      const idx = queueIndex++;
      if (idx >= queue.length) break;

      const item = queue[idx];
      const result = await runScenario(item.scenarioId, admin, config.chaos);

      report.totalRuns++;
      report.timings.get(item.scenarioId)!.push(result.durationMs);

      if (result.passed) {
        report.passed++;
        if (!config.quiet) {
          process.stdout.write(
            `  [W${workerId}] #${item.scenarioId} iter ${item.iteration}/${config.count}: ✅ ${result.durationMs}ms\n`,
          );
        }
      } else {
        report.failed++;
        const errMsg =
          result.error ||
          result.verifications
            .filter((v) => !v.passed)
            .map((v) => `${v.check}: expected ${v.expected}, got ${v.actual}`)
            .join("; ");

        report.errors.push({
          scenarioId: item.scenarioId,
          iteration: item.iteration,
          error: errMsg,
        });

        if (!config.quiet) {
          process.stdout.write(
            `  [W${workerId}] #${item.scenarioId} iter ${item.iteration}/${config.count}: ❌ ${errMsg}\n`,
          );
        }

        if (config.bail) {
          bailOut = true;
        }
      }
    }
  }

  // Launch workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < config.concurrency; i++) {
    workers.push(worker(i + 1));
  }
  await Promise.all(workers);

  report.endTime = performance.now();
  return report;
}

// ═══════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printReport(config: StressConfig, report: StressReport): void {
  const totalMs = Math.round(report.endTime - report.startTime);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STRESS TEST REPORT`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Scenarios:   ${config.scenarioIds.join(", ")}`);
  console.log(`  Iterations:  ${config.count} per scenario`);
  console.log(`  Concurrency: ${config.concurrency} workers`);
  console.log(`  Chaos:       ${config.chaos ? "ON" : "OFF"}`);
  console.log(`  Total time:  ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`${"─".repeat(60)}`);
  console.log(
    `  Results:     ${report.passed} passed, ${report.failed} failed (${report.totalRuns} total)`,
  );
  console.log(
    `  Pass rate:   ${((report.passed / report.totalRuns) * 100).toFixed(1)}%`,
  );
  console.log(`${"─".repeat(60)}`);

  // Per-scenario timing
  console.log(`\n  Timing by scenario (ms):`);
  console.log(
    `  ${"Scenario".padEnd(40)} ${"P50".padStart(7)} ${"P90".padStart(7)} ${"P99".padStart(7)} ${"Max".padStart(7)}`,
  );

  for (const [scenarioId, timings] of report.timings) {
    if (timings.length === 0) continue;
    const sorted = [...timings].sort((a, b) => a - b);
    const name =
      scenarios.find((s) => s.id === scenarioId)?.name || `#${scenarioId}`;
    const label = `  #${scenarioId} ${name}`.padEnd(40);
    console.log(
      `${label} ${String(percentile(sorted, 50)).padStart(7)} ${String(percentile(sorted, 90)).padStart(7)} ${String(percentile(sorted, 99)).padStart(7)} ${String(sorted[sorted.length - 1]).padStart(7)}`,
    );
  }

  if (report.errors.length > 0) {
    console.log(`\n  Errors (first 10):`);
    for (const err of report.errors.slice(0, 10)) {
      console.log(
        `    #${err.scenarioId} iter ${err.iteration}: ${err.error.substring(0, 100)}`,
      );
    }
  }

  console.log(`\n${"═".repeat(60)}\n`);
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const config = parseArgs();

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  SME Payments — Stress Test Orchestrator         ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  console.log(`  Logging in as admin...`);
  const admin = await loginAdmin();
  console.log(`  ✓ Admin authenticated\n`);

  console.log(
    `  Starting ${config.scenarioIds.length} scenarios × ${config.count} iterations with ${config.concurrency} workers${config.chaos ? " (CHAOS)" : ""}...\n`,
  );

  const report = await runWorkerPool(config, admin);
  printReport(config, report);

  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
