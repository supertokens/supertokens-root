#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════
// Java Build Tools – MCP Server
// Exposes compile / test / lint tools backed by Gradle.
//
// Transport modes:
//   - Set MCP_TRANSPORT=sse (default) for HTTP on port 3000
//     * GET  /api/tools  – list tools (stateless HTTP API)
//     * POST /api/call   – call a tool (stateless HTTP API)
//     * GET  /sse        – SSE transport (MCP protocol, legacy)
//   - Set MCP_TRANSPORT=stdio for stdin/stdout (legacy)
//
// Task model:
//   - compile/test/lint start tasks asynchronously and return a task ID
//   - Use task_status to poll for completion and get results
//   - Use task_cancel to abort a running task
// ═══════════════════════════════════════════════════════════════════════

import { McpServer }            from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport }   from "@modelcontextprotocol/sdk/server/sse.js";
import { z }                    from "zod";
import { zodToJsonSchema }      from "zod-to-json-schema";
import { spawn }                from "node:child_process";
import { createServer }         from "node:http";
import {
  readFileSync, existsSync, readdirSync,
  accessSync, chmodSync, rmSync, constants,
  mkdirSync, writeFileSync, cpSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration (override via environment) ────────────────────────

const WORKSPACE       = process.env.JAVA_MCP_WORKSPACE        || "/workspace";
const COMPILE_TIMEOUT = (parseInt(process.env.JAVA_MCP_COMPILE_TIMEOUT_SECS || "600")) * 1000;
const TEST_TIMEOUT    = (parseInt(process.env.JAVA_MCP_TEST_TIMEOUT_SECS    || "3600")) * 1000;
const LINT_TIMEOUT    = (parseInt(process.env.JAVA_MCP_LINT_TIMEOUT_SECS    || "300")) * 1000;
const MAX_OUTPUT      = parseInt(process.env.JAVA_MCP_MAX_OUTPUT_CHARS      || "60000");
const MCP_TRANSPORT   = process.env.MCP_TRANSPORT             || "sse";
const MCP_PORT        = parseInt(process.env.MCP_PORT         || "3000");

// ── Test run history ─────────────────────────────────────────────
const TEST_RUNS_DIR    = join(WORKSPACE, ".test-runs");
const MAX_TEST_RUNS    = parseInt(process.env.JAVA_MCP_MAX_TEST_RUNS || "10");
const PG_STAT_MONITOR_OUTPUT_DIR = process.env.PG_STAT_MONITOR_OUTPUT_DIR
  ? (process.env.PG_STAT_MONITOR_OUTPUT_DIR.startsWith("/")
      ? process.env.PG_STAT_MONITOR_OUTPUT_DIR
      : join(WORKSPACE, process.env.PG_STAT_MONITOR_OUTPUT_DIR))
  : join(WORKSPACE, "supertokens-core", "pg_stat_monitor_output");
const COLLECT_PG_STAT_MONITOR = (process.env.COLLECT_PG_STAT_MONITOR || "").toLowerCase() === "true";

// ── Task Registry ───────────────────────────────────────────────────

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} type - 'compile' | 'test' | 'lint'
 * @property {'running' | 'completed' | 'failed' | 'cancelled'} status
 * @property {number} startedAt
 * @property {number} [completedAt]
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} [exitCode]
 * @property {boolean} [timedOut]
 * @property {ChildProcess} [process]
 * @property {Object} [testReport] - For test tasks only
 */

/** @type {Map<string, Task>} */
const tasks = new Map();
let taskCounter = 0;

function generateTaskId() {
  return `task-${++taskCounter}-${Date.now().toString(36)}`;
}

// Clean up old completed tasks (keep last 20)
function pruneOldTasks() {
  const completed = [...tasks.values()]
    .filter(t => t.status !== "running")
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  for (const task of completed.slice(20)) {
    tasks.delete(task.id);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Log to stderr so we never pollute the MCP stdio channel. */
function log(msg) {
  process.stderr.write(`[java-mcp] ${msg}\n`);
}

/** Resolve the Gradle executable – prefer the project wrapper. */
function getGradleCommand() {
  const wrapper = join(WORKSPACE, "gradlew");
  if (existsSync(wrapper)) {
    try { accessSync(wrapper, constants.X_OK); }
    catch { chmodSync(wrapper, 0o755); }
    return wrapper;
  }
  return "gradle";   // fall back to the globally installed copy
}

/** Ensure the workspace looks like a Gradle project. */
function validateWorkspace() {
  const markers = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
  if (!markers.some(f => existsSync(join(WORKSPACE, f)))) {
    return "No Gradle project detected in /workspace. " +
           "Make sure the Docker volume is mounted correctly " +
           "(-v /path/to/project:/workspace).";
  }
  return null;
}

/** Truncate very long output from the middle so head and tail are preserved. */
function truncate(str) {
  if (str.length <= MAX_OUTPUT) return str;
  const half = Math.floor(MAX_OUTPUT / 2) - 40;
  return (
    str.substring(0, half) +
    `\n\n──── [truncated ${(str.length - MAX_OUTPUT).toLocaleString()} chars] ────\n\n` +
    str.substring(str.length - half)
  );
}

// ── Test run history ────────────────────────────────────────────────

/**
 * Generate a run folder name from the current time and optional test filter.
 * @param {string|null} filter
 * @param {number} [timestamp]
 * @returns {string} e.g. "run-2024-01-15T10-30-00--MyTest"
 */
function generateRunId(filter, timestamp = Date.now()) {
  const d = new Date(timestamp);
  const ts = d.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
  if (!filter) return `run-${ts}`;
  const safe = filter.replace(/[^a-zA-Z0-9._-]/g, "").substring(0, 60);
  return safe ? `run-${ts}--${safe}` : `run-${ts}`;
}

/**
 * Keep only the MAX_TEST_RUNS most recent run folders.
 * Lexicographic sort = chronological due to ISO timestamp format.
 */
function pruneTestRuns() {
  if (!existsSync(TEST_RUNS_DIR)) return;
  try {
    const entries = readdirSync(TEST_RUNS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith("run-"))
      .map(e => e.name)
      .sort();
    if (entries.length <= MAX_TEST_RUNS) return;
    for (const name of entries.slice(0, entries.length - MAX_TEST_RUNS)) {
      log(`[pruneTestRuns] Removing old run: ${name}`);
      rmSync(join(TEST_RUNS_DIR, name), { recursive: true, force: true });
    }
  } catch (e) {
    log(`[pruneTestRuns] Error: ${e.message}`);
  }
}

/**
 * Archive test results from a completed test run into a persistent run folder.
 * Copies per-test output JSONs, JUnit summary, and pg_stat_monitor files.
 * @param {Task} task
 * @returns {string} The runId
 */
function archiveTestRun(task) {
  const runId = generateRunId(task.testFilter, task.startedAt);
  const runDir = join(TEST_RUNS_DIR, runId);
  const outputsDir = join(runDir, "outputs");
  const dbStatsDir = join(runDir, "db-stats");

  mkdirSync(outputsDir, { recursive: true });
  mkdirSync(dbStatsDir, { recursive: true });

  // 1. Copy per-test output JSON files
  const testOutputFiles = findTestOutputFiles();
  for (const srcPath of testOutputFiles) {
    try {
      cpSync(srcPath, join(outputsDir, basename(srcPath)));
    } catch (e) {
      log(`[archiveTestRun] Failed to copy ${srcPath}: ${e.message}`);
    }
  }

  // 2. Parse test outputs for the summary
  const testResults = parseTestOutputs();

  // 3. Copy pg_stat_monitor files (if collection is enabled)
  let hasDbStats = false;
  if (existsSync(PG_STAT_MONITOR_OUTPUT_DIR)) {
    try {
      const entries = readdirSync(PG_STAT_MONITOR_OUTPUT_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          try {
            cpSync(
              join(PG_STAT_MONITOR_OUTPUT_DIR, entry.name),
              join(dbStatsDir, entry.name),
            );
            hasDbStats = true;
          } catch (e) {
            log(`[archiveTestRun] Failed to copy db stat ${entry.name}: ${e.message}`);
          }
        }
      }
      // Clean originals so next run starts fresh
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          try { rmSync(join(PG_STAT_MONITOR_OUTPUT_DIR, entry.name)); } catch {}
        }
      }
    } catch (e) {
      log(`[archiveTestRun] Failed to read pg_stat_monitor dir: ${e.message}`);
    }
  }

  // 4. Parse JUnit XML reports for summary
  const report = parseTestReports();

  // 5. Annotate each test with hasDbStats
  const dbStatFiles = hasDbStats
    ? readdirSync(dbStatsDir).filter(f => f.endsWith(".json"))
    : [];
  for (const t of testResults) {
    t.hasDbStats = dbStatFiles.some(f => f.includes(t.testName));
  }

  // 6. Write summary.json
  const summary = {
    runId,
    taskId: task.id,
    filter: task.testFilter || null,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: task.completedAt - task.startedAt,
    exitCode: task.exitCode,
    status: task.status,
    report,
    tests: testResults,
    archivedAt: Date.now(),
    hasDbStats,
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));

  log(`[archiveTestRun] Archived run ${runId} (${testResults.length} tests, ${dbStatFiles.length} db-stat files)`);
  pruneTestRuns();
  return runId;
}

/**
 * List all archived test runs, most recent first.
 * Returns lightweight summaries (no full tests array).
 */
function listTestRuns() {
  if (!existsSync(TEST_RUNS_DIR)) return [];
  try {
    const entries = readdirSync(TEST_RUNS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith("run-"))
      .map(e => e.name)
      .sort()
      .reverse();

    const runs = [];
    for (const name of entries) {
      const summaryPath = join(TEST_RUNS_DIR, name, "summary.json");
      if (!existsSync(summaryPath)) continue;
      try {
        const s = JSON.parse(readFileSync(summaryPath, "utf-8"));
        runs.push({
          runId: s.runId,
          filter: s.filter,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          durationMs: s.durationMs,
          status: s.status,
          total: s.report?.total || 0,
          passed: s.report?.passed || 0,
          failures: s.report?.failures || 0,
          errors: s.report?.errors || 0,
          skipped: s.report?.skipped || 0,
          hasDbStats: s.hasDbStats || false,
        });
      } catch { /* corrupted summary */ }
    }
    return runs;
  } catch { return []; }
}

/** Get the runId of the most recent archived test run. */
function getLatestRunId() {
  const runs = listTestRuns();
  return runs.length > 0 ? runs[0].runId : null;
}

/** Load the full summary.json for a specific run. */
function getRunSummary(runId) {
  const summaryPath = join(TEST_RUNS_DIR, runId, "summary.json");
  if (!existsSync(summaryPath)) return null;
  try { return JSON.parse(readFileSync(summaryPath, "utf-8")); }
  catch { return null; }
}

/**
 * Get the full test output JSON from an archived run.
 * Tries exact filename match first, then falls back to scanning.
 */
function getArchivedTestOutput(runId, testId) {
  const outputsDir = join(TEST_RUNS_DIR, runId, "outputs");
  if (!existsSync(outputsDir)) return null;

  // Match the sanitization from gradle-init.gradle
  const safeName = testId.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
  const filePath = join(outputsDir, safeName);
  if (existsSync(filePath)) {
    try { return JSON.parse(readFileSync(filePath, "utf-8")); }
    catch { /* fall through */ }
  }

  // Fallback: scan all files and match by testId field
  try {
    for (const f of readdirSync(outputsDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(outputsDir, f), "utf-8"));
        if (data.testId === testId) return data;
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Get pg_stat_monitor stats from an archived run.
 * @param {string} runId
 * @param {string|null} testId - filter to a specific test, or null for all
 * @returns {Array<{filename: string, stats: Array}>}
 */
function getArchivedDbStats(runId, testId) {
  const dbStatsDir = join(TEST_RUNS_DIR, runId, "db-stats");
  if (!existsSync(dbStatsDir)) return [];

  const results = [];
  try {
    const files = readdirSync(dbStatsDir).filter(f => f.endsWith(".json"));
    for (const filename of files) {
      if (testId) {
        const methodName = testId.includes(".")
          ? testId.substring(testId.lastIndexOf(".") + 1)
          : testId;
        if (!filename.includes(methodName)) continue;
      }
      try {
        const stats = JSON.parse(readFileSync(join(dbStatsDir, filename), "utf-8"));
        results.push({ filename, stats });
      } catch {}
    }
  } catch {}
  return results;
}

// ── Async Gradle runner ─────────────────────────────────────────────

/**
 * Start a Gradle process asynchronously.
 * Returns immediately with a Task object.
 */
function startGradleTask(taskType, args, timeoutMs) {
  const taskId = generateTaskId();
  const cmd = getGradleCommand();
  log(`[${taskId}] Starting ${taskType}: ${cmd} ${args.join(" ")}`);

  const task = {
    id: taskId,
    type: taskType,
    status: "running",
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    process: null,
  };

  const child = spawn(cmd, args, {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      TERM: "dumb",
      // Suppress ARM SVE warning on Apple Silicon
      JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ""} -XX:UseSVE=0`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  task.process = child;

  // Timeout guard
  const timer = setTimeout(() => {
    if (task.status === "running") {
      log(`[${taskId}] Timeout after ${timeoutMs / 1000}s`);
      task.timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 10_000);
    }
  }, timeoutMs);

  // Stream output to docker logs AND accumulate for final result.
  // We use stderr (not stdout) to follow MCP convention: stdout is reserved
  // for protocol messages in stdio mode. With SSE mode either would work,
  // but stderr keeps compatibility if someone switches transports.
  child.stdout.on("data", (d) => {
    task.stdout += d;
    process.stderr.write(d);
  });
  child.stderr.on("data", (d) => {
    task.stderr += d;
    process.stderr.write(d);
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    task.exitCode = code ?? -1;
    task.completedAt = Date.now();
    task.stdout = truncate(task.stdout);
    task.stderr = truncate(task.stderr);
    task.process = null;

    if (task.status === "cancelled") {
      // Already marked as cancelled
    } else if (task.timedOut) {
      task.status = "failed";
      task.stderr += `\n\n⏱️  Process killed — exceeded timeout of ${timeoutMs / 1000}s`;
    } else if (code === 0) {
      task.status = "completed";
    } else {
      task.status = "failed";
    }

    log(`[${taskId}] Finished with status: ${task.status}`);

    // Archive test results for completed/failed test tasks
    if (task.type === "test" && task.status !== "cancelled") {
      try {
        task.runId = archiveTestRun(task);
        task.archived = true;
        log(`[${taskId}] Archived as ${task.runId}`);
      } catch (e) {
        log(`[${taskId}] Archival failed: ${e.message}`);
        task.archived = false;
      }
    }

    pruneOldTasks();
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    task.exitCode = -1;
    task.completedAt = Date.now();
    task.stderr = `Failed to start process: ${err.message}`;
    task.status = "failed";
    task.process = null;
    log(`[${taskId}] Error: ${err.message}`);
  });

  tasks.set(taskId, task);
  return task;
}

// ── Async Script runner ─────────────────────────────────────────────

const SCRIPT_TIMEOUT = (parseInt(process.env.JAVA_MCP_SCRIPT_TIMEOUT_SECS || "300")) * 1000;

/**
 * Start a shell script asynchronously.
 * Returns immediately with a Task object.
 */
function startScriptTask(taskType, scriptPath, args, timeoutMs = SCRIPT_TIMEOUT) {
  const taskId = generateTaskId();
  const fullPath = join(WORKSPACE, scriptPath);
  log(`[${taskId}] Starting ${taskType}: ${fullPath} ${args.join(" ")}`);

  const task = {
    id: taskId,
    type: taskType,
    status: "running",
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    process: null,
  };

  const child = spawn(fullPath, args, {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      TERM: "dumb",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  task.process = child;

  const timer = setTimeout(() => {
    if (task.status === "running") {
      log(`[${taskId}] Timeout after ${timeoutMs / 1000}s`);
      task.timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 10_000);
    }
  }, timeoutMs);

  child.stdout.on("data", (d) => {
    task.stdout += d;
    process.stderr.write(d);
  });
  child.stderr.on("data", (d) => {
    task.stderr += d;
    process.stderr.write(d);
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    task.exitCode = code ?? -1;
    task.completedAt = Date.now();
    task.stdout = truncate(task.stdout);
    task.stderr = truncate(task.stderr);
    task.process = null;

    if (task.status === "cancelled") {
      // Already marked as cancelled
    } else if (task.timedOut) {
      task.status = "failed";
      task.stderr += `\n\n⏱️  Process killed — exceeded timeout of ${timeoutMs / 1000}s`;
    } else if (code === 0) {
      task.status = "completed";
    } else {
      task.status = "failed";
    }

    log(`[${taskId}] Finished with status: ${task.status}`);
    pruneOldTasks();
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    task.exitCode = -1;
    task.completedAt = Date.now();
    task.stderr = `Failed to start process: ${err.message}`;
    task.status = "failed";
    task.process = null;
    log(`[${taskId}] Error: ${err.message}`);
  });

  tasks.set(taskId, task);
  return task;
}

/** Check if test environment is already set up */
function isTestEnvRunning() {
  return existsSync(join(WORKSPACE, ".testEnvRunning"));
}

// ── Test-report parser ──────────────────────────────────────────────

/** Recursively find JUnit XML reports under build/ directories. */
function findTestReportFiles() {
  const files = [];
  function walk(dir, depth) {
    if (depth > 10) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", ".gradle", ".git", ".test-runs", "dev-tools"].includes(entry.name)) {
          walk(full, depth + 1);
        } else if (
          entry.isFile() &&
          entry.name.startsWith("TEST-") &&
          entry.name.endsWith(".xml")
        ) {
          files.push(full);
        }
      }
    } catch { /* permission / missing dir – ignore */ }
  }
  walk(WORKSPACE, 0);
  return files;
}

/**
 * Parse all JUnit XML test reports into a summary.
 */
function parseTestReports() {
  const xmlFiles = findTestReportFiles();
  let total = 0, failures = 0, errors = 0, skipped = 0;
  const failureDetails = [];

  for (const path of xmlFiles) {
    try {
      const xml = readFileSync(path, "utf-8");
      const suite = xml.match(/<testsuite[^>]*/);
      if (!suite) continue;

      const a = suite[0];
      total    += parseInt(a.match(/tests="(\d+)"/)?.[1]    || "0");
      failures += parseInt(a.match(/failures="(\d+)"/)?.[1] || "0");
      errors   += parseInt(a.match(/errors="(\d+)"/)?.[1]   || "0");
      skipped  += parseInt(a.match(/skipped="(\d+)"/)?.[1]  || "0");

      const tcRegex = /<testcase\s+name="(?<name>[^"]*)"[^>]*classname="(?<cls>[^"]*)"[^>]*>(?<body>[\s\S]*?)<\/testcase>/g;
      let m;
      while ((m = tcRegex.exec(xml)) !== null) {
        const body = m.groups.body;
        const fMatch = body.match(/<(?:failure|error)[^>]*?(?:message="(?<msg>[^"]*)")?[^>]*>(?<trace>[\s\S]*?)<\/(?:failure|error)>/);
        if (fMatch) {
          failureDetails.push({
            test: `${m.groups.cls}.${m.groups.name}`,
            message: (fMatch.groups.msg || "").substring(0, 300),
            trace:   (fMatch.groups.trace || "").trim().substring(0, 500),
          });
        }
      }
    } catch { /* corrupted file – skip */ }
  }

  const passed = total - failures - errors - skipped;
  return { total, passed, failures, errors, skipped, failureDetails };
}

// ── Per-test output parser ──────────────────────────────────────────

/** Find all per-test output JSON files generated by the init script. */
function findTestOutputFiles() {
  const files = [];
  function walk(dir, depth) {
    if (depth > 10) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "test-output") {
            // Found test-output directory, collect JSON files
            try {
              for (const f of readdirSync(full, { withFileTypes: true })) {
                if (f.isFile() && f.name.endsWith(".json")) {
                  files.push(join(full, f.name));
                }
              }
            } catch { /* permission error */ }
          } else if (!["node_modules", ".gradle", ".git", ".test-runs", "dev-tools"].includes(entry.name)) {
            walk(full, depth + 1);
          }
        }
      }
    } catch { /* permission / missing dir – ignore */ }
  }
  walk(WORKSPACE, 0);
  return files;
}

/**
 * Parse all per-test output files into a structured result.
 * Returns an array of test results with stdout/stderr.
 */
function parseTestOutputs() {
  const files = findTestOutputFiles();
  const results = [];

  for (const path of files) {
    try {
      const content = readFileSync(path, "utf-8");
      const data = JSON.parse(content);
      results.push({
        testId: data.testId,
        className: data.className,
        testName: data.testName,
        status: data.resultType, // SUCCESS, FAILURE, SKIPPED
        duration: data.endTime - data.startTime,
        hasOutput: !!(data.stdout || data.stderr),
        failureMessage: data.failureMessage || null,
      });
    } catch { /* corrupted file – skip */ }
  }

  return results.sort((a, b) => a.testId.localeCompare(b.testId));
}

/**
 * Get detailed output for a specific test by testId.
 */
function getTestOutput(testId) {
  const files = findTestOutputFiles();

  for (const path of files) {
    try {
      const content = readFileSync(path, "utf-8");
      const data = JSON.parse(content);
      if (data.testId === testId) {
        return data;
      }
    } catch { /* corrupted file – skip */ }
  }

  return null;
}

/** Delete stale test-results and test-output so old runs don't bleed into new parses. */
function cleanTestResults() {
  function walk(dir, depth) {
    if (depth > 8) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "test-results" || entry.name === "test-output") {
            rmSync(full, { recursive: true, force: true });
          } else if (!["node_modules", ".gradle", ".git", ".test-runs", "dev-tools"].includes(entry.name)) {
            walk(full, depth + 1);
          }
        }
      }
    } catch {}
  }
  walk(WORKSPACE, 0);

  // Clean pg_stat_monitor output directory so next run starts fresh
  // if (existsSync(PG_STAT_MONITOR_OUTPUT_DIR)) {
  //   try {
  //     for (const f of readdirSync(PG_STAT_MONITOR_OUTPUT_DIR)) {
  //       if (f.endsWith(".json")) {
  //         rmSync(join(PG_STAT_MONITOR_OUTPUT_DIR, f), { force: true });
  //       }
  //     }
  //   } catch {}
  // }
}

// ── Lint-task detection ─────────────────────────────────────────────

const KNOWN_LINT_PLUGINS = {
  "checkstyle":              ["checkstyleMain", "checkstyleTest"],
  "com.diffplug.spotless":   ["spotlessCheck"],
  "spotless":                ["spotlessCheck"],
  "pmd":                     ["pmdMain"],
  "com.github.spotbugs":     ["spotbugsMain"],
  "spotbugs":                ["spotbugsMain"],
};

function detectLintTasks() {
  const buildFiles = ["build.gradle", "build.gradle.kts"];
  const detected = new Set();

  for (const name of buildFiles) {
    const p = join(WORKSPACE, name);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, "utf-8");
    for (const [plugin, pluginTasks] of Object.entries(KNOWN_LINT_PLUGINS)) {
      if (content.includes(plugin)) {
        pluginTasks.forEach(t => detected.add(t));
      }
    }
  }
  return [...detected];
}

// ── Result formatters ───────────────────────────────────────────────

function formatCompileResult(task) {
  const sections = [
    task.status === "completed" ? "✅ COMPILATION SUCCESSFUL" : "❌ COMPILATION FAILED",
  ];
  if (task.timedOut) sections.push(`⏱️  Timed out`);

  const combined = [task.stdout, task.stderr].filter(Boolean).join("\n");
  if (combined.trim()) {
    sections.push("", "─── Gradle output ───", combined.trim());
  }
  return sections.join("\n");
}

function formatTestResult(task) {
  const sections = [];
  const report = task.testReport || parseTestReports();

  if (report.total > 0) {
    const header = task.status === "completed" ? "✅ ALL TESTS PASSED" : "❌ TESTS FAILED";
    sections.push(
      header, "",
      "─── Summary ───",
      `Total: ${report.total}  |  Passed: ${report.passed}  |  ` +
      `Failed: ${report.failures}  |  Errors: ${report.errors}  |  Skipped: ${report.skipped}`,
    );

    if (report.failureDetails.length > 0) {
      sections.push("", "─── Failure details ───");
      const cap = 25;
      for (const f of report.failureDetails.slice(0, cap)) {
        sections.push(`\n▸ ${f.test}`);
        if (f.message) sections.push(`  Message: ${f.message}`);
        if (f.trace)   sections.push(`  ${f.trace}`);
      }
      if (report.failureDetails.length > cap) {
        sections.push(`\n… and ${report.failureDetails.length - cap} more`);
      }
    }
  } else {
    sections.push(task.status === "completed"
      ? "✅ TESTS PASSED (no JUnit XML reports found)"
      : "❌ TESTS FAILED");
  }

  if (task.runId) {
    sections.push(
      "",
      `📁 Archived as: ${task.runId}`,
      `   Use test_results({ runId: "${task.runId}" }) to browse.`,
      `   Use test_runs() to see all archived runs.`,
    );
  }

  const combined = [task.stdout, task.stderr].filter(Boolean).join("\n");
  if (combined.trim()) {
    sections.push("", "─── Gradle output ───", combined.trim());
  }
  return sections.join("\n");
}

function formatLintResult(task, taskNames) {
  const sections = [
    task.status === "completed" ? "✅ LINT CHECKS PASSED" : "❌ LINT CHECKS FAILED",
    `Tasks executed: ${taskNames.join(", ")}`,
  ];

  const combined = [task.stdout, task.stderr].filter(Boolean).join("\n");
  if (combined.trim()) {
    sections.push("", "─── Output ───", combined.trim());
  }
  return sections.join("\n");
}

// ── Tool definitions (single source of truth) ──────────────────────

const TOOLS = [
  {
    name: "compile",
    description:
      "Start compiling the Java project (main + test sources). " +
      "Returns a task ID immediately. Use task_status to check progress and get results.",
    schema: {
      clean: z.boolean().default(false).describe(
        "Run `clean` before compiling to force a full rebuild"
      ),
    },
    handler: async ({ clean }) => {
    const err = validateWorkspace();
    if (err) return { content: [{ type: "text", text: `❌ ${err}` }], isError: true };

    const args = [];
    if (clean) args.push("clean");
    args.push("classes", "testClasses", "--console=plain", "--no-daemon");

    const task = startGradleTask("compile", args, COMPILE_TIMEOUT);

    return {
      content: [{
        type: "text",
        text: `🚀 Compilation started.\n\nTask ID: ${task.id}\n\nUse task_status({ taskId: "${task.id}" }) to check progress.`
      }],
    };
    },
  },

  {
    name: "test",
    description:
      "Start running project tests. " +
      "Returns a task ID immediately. Use task_status to check progress and get results. " +
      "Use skipBuild=true to skip recompilation (faster if code hasn't changed).",
    schema: {
      filter: z.string().optional().describe(
        'Test filter pattern passed to --tests, e.g. "com.example.MyTest", ' +
        '"*IntegrationTest", "*.MyTest.specificMethod"'
      ),
      clean: z.boolean().default(false).describe(
        "Run `clean` before testing"
      ),
      skipBuild: z.boolean().default(false).describe(
        "Skip compilation step (-x compileJava -x compileTestJava). " +
        "Faster when code hasn't changed. Requires prior compilation."
      ),
    },
    handler: async ({ filter, clean, skipBuild }) => {
    const err = validateWorkspace();
    if (err) return { content: [{ type: "text", text: `❌ ${err}` }], isError: true };

    // Warn if test env not set up
    if (!isTestEnvRunning()) {
      log("Warning: .testEnvRunning not found - test environment may not be set up");
    }

    cleanTestResults();

    const args = [];
    if (clean) args.push("clean");
    args.push("test", "--console=plain", "--no-daemon", "--continue");
    // Use init script to capture per-test stdout/stderr
    const initScript = join(__dirname, "gradle-init.gradle");
    if (existsSync(initScript)) {
      args.push("--init-script", initScript);
    }
    if (filter) args.push("--tests", filter);
    if (skipBuild) {
      // Skip compilation tasks for faster test runs
      args.push("-x", "compileJava", "-x", "compileTestJava", "-x", "processResources", "-x", "processTestResources");
    }

    const task = startGradleTask("test", args, TEST_TIMEOUT);
    task.testFilter = filter || null;

    return {
      content: [{
        type: "text",
        text: `🧪 Tests started${filter ? ` (filter: ${filter})` : ""}.\n\nTask ID: ${task.id}\n\nUse task_status({ taskId: "${task.id}" }) to check progress.`
      }],
    };
    },
  },

  {
    name: "lint",
    description:
      "Start linting / formatting checks. " +
      "Returns a task ID immediately. Use task_status to check progress and get results.",
    schema: {
      task: z.string().optional().describe(
        'Explicit Gradle task to run, e.g. "checkstyleMain", "spotlessCheck". ' +
        "Omit to auto-detect from the build file."
      ),
    },
    handler: async ({ task }) => {
    const err = validateWorkspace();
    if (err) return { content: [{ type: "text", text: `❌ ${err}` }], isError: true };

    let lintTasks;
    if (task) {
      lintTasks = [task];
    } else {
      lintTasks = detectLintTasks();
      if (lintTasks.length === 0) {
        return {
          content: [{
            type: "text",
            text: [
              "⚠️  No lint/formatting plugins detected in build.gradle(.kts).",
              "",
              "Supported auto-detection: checkstyle, spotless, pmd, spotbugs.",
              "",
              "You can either:",
              "  • Add a plugin to your build file",
              "  • Or specify a task explicitly: lint({ task: 'checkstyleMain' })",
            ].join("\n"),
          }],
          isError: false,
        };
      }
    }

    const args = [...lintTasks, "--console=plain", "--no-daemon"];
    const gradleTask = startGradleTask("lint", args, LINT_TIMEOUT);
    gradleTask.lintTasks = lintTasks; // Store for result formatting

    return {
      content: [{
        type: "text",
        text: `🔍 Lint started (tasks: ${lintTasks.join(", ")}).\n\nTask ID: ${gradleTask.id}\n\nUse task_status({ taskId: "${gradleTask.id}" }) to check progress.`
      }],
    };
    },
  },

  {
    name: "setup_test_env",
    description:
      "Set up the test environment by running utils/setupTestEnv. " +
      "Copies JARs and creates config files needed for testing. " +
      "By default skips rebuilding (use skipBuild=false to force rebuild).",
    schema: {
      skipBuild: z.boolean().default(true).describe(
        "Skip the build step (default: true). Set to false to rebuild all modules."
      ),
      cicd: z.boolean().default(false).describe(
        "Use CICD mode (downloads dependencies from API instead of local build)"
      ),
    },
    handler: async ({ skipBuild, cicd }) => {
    const err = validateWorkspace();
    if (err) return { content: [{ type: "text", text: `❌ ${err}` }], isError: true };

    const scriptPath = "utils/setupTestEnv";
    if (!existsSync(join(WORKSPACE, scriptPath))) {
      return {
        content: [{ type: "text", text: `❌ Script not found: ${scriptPath}` }],
        isError: true,
      };
    }

    const args = [];
    if (skipBuild) args.push("--skip-build");
    if (cicd) args.push("--cicd");

    const task = startScriptTask("setup_test_env", scriptPath, args);

    return {
      content: [{
        type: "text",
        text: `🔧 Setting up test environment${skipBuild ? " (skip-build)" : ""}...\n\nTask ID: ${task.id}\n\nUse task_status({ taskId: "${task.id}" }) to check progress.`
      }],
    };
    },
  },

  {
    name: "clean_test_env",
    description:
      "Clean up the test environment by running utils/cleanTestEnv. " +
      "Removes JARs, config files, and the .testEnvRunning marker.",
    schema: {
      silent: z.boolean().default(false).describe(
        "Suppress output messages"
      ),
    },
    handler: async ({ silent }) => {
    const err = validateWorkspace();
    if (err) return { content: [{ type: "text", text: `❌ ${err}` }], isError: true };

    const scriptPath = "utils/cleanTestEnv";
    if (!existsSync(join(WORKSPACE, scriptPath))) {
      return {
        content: [{ type: "text", text: `❌ Script not found: ${scriptPath}` }],
        isError: true,
      };
    }

    const args = [];
    if (silent) args.push("--silent");

    const task = startScriptTask("clean_test_env", scriptPath, args);

    return {
      content: [{
        type: "text",
        text: `🧹 Cleaning test environment...\n\nTask ID: ${task.id}\n\nUse task_status({ taskId: "${task.id}" }) to check progress.`
      }],
    };
    },
  },

  {
    name: "task_status",
    description:
      "Check the status of a running task and get results when complete. " +
      "Call this after starting a compile/test/lint task.",
    schema: {
      taskId: z.string().describe("The task ID returned by compile/test/lint"),
    },
    handler: async ({ taskId }) => {
    const task = tasks.get(taskId);

    if (!task) {
      return {
        content: [{ type: "text", text: `❌ Task not found: ${taskId}` }],
        isError: true,
      };
    }

    if (task.status === "running") {
      const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
      // Show recent output for progress indication
      const recentOutput = (task.stdout + task.stderr).slice(-2000);
      return {
        content: [{
          type: "text",
          text: `⏳ Task ${taskId} is still running (${elapsed}s elapsed).\n\nType: ${task.type}\n\n─── Recent output ───\n${recentOutput || "(no output yet)"}`
        }],
      };
    }

    // Task is complete - format results based on type
    let resultText;
    if (task.type === "compile") {
      resultText = formatCompileResult(task);
    } else if (task.type === "test") {
      task.testReport = parseTestReports();
      // Fallback archival if the close handler didn't archive
      if (!task.archived && task.status !== "cancelled") {
        try {
          task.runId = archiveTestRun(task);
          task.archived = true;
        } catch (e) {
          log(`[task_status] Fallback archival failed for ${taskId}: ${e.message}`);
        }
      }
      resultText = formatTestResult(task);
    } else if (task.type === "lint") {
      resultText = formatLintResult(task, task.lintTasks || ["unknown"]);
    } else {
      resultText = `Status: ${task.status}\n\n${task.stdout}\n${task.stderr}`;
    }

    const elapsed = Math.round((task.completedAt - task.startedAt) / 1000);
    return {
      content: [{
        type: "text",
        text: `Task ${taskId} completed in ${elapsed}s.\n\n${resultText}`
      }],
      isError: task.status === "failed",
    };
    },
  },

  {
    name: "task_cancel",
    description: "Cancel a running task.",
    schema: {
      taskId: z.string().describe("The task ID to cancel"),
    },
    handler: async ({ taskId }) => {
    const task = tasks.get(taskId);

    if (!task) {
      return {
        content: [{ type: "text", text: `❌ Task not found: ${taskId}` }],
        isError: true,
      };
    }

    if (task.status !== "running") {
      return {
        content: [{ type: "text", text: `Task ${taskId} is not running (status: ${task.status})` }],
      };
    }

    task.status = "cancelled";
    if (task.process) {
      task.process.kill("SIGTERM");
      setTimeout(() => { try { task.process?.kill("SIGKILL"); } catch {} }, 5000);
    }

    return {
      content: [{ type: "text", text: `✓ Cancellation signal sent to task ${taskId}` }],
    };
    },
  },

  {
    name: "task_list",
    description: "List all tasks (running and recent completed).",
    schema: {},
    handler: async () => {
    if (tasks.size === 0) {
      return {
        content: [{ type: "text", text: "No tasks." }],
      };
    }

    const lines = ["─── Tasks ───", ""];
    const sortedTasks = [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);

    for (const task of sortedTasks) {
      const elapsed = task.completedAt
        ? Math.round((task.completedAt - task.startedAt) / 1000)
        : Math.round((Date.now() - task.startedAt) / 1000);

      const status = task.status === "running" ? "⏳ running" :
                     task.status === "completed" ? "✅ completed" :
                     task.status === "cancelled" ? "🚫 cancelled" : "❌ failed";

      lines.push(`${task.id}  ${status}  ${task.type}  (${elapsed}s)`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
    },
  },

  {
    name: "test_results",
    description:
      "List all test results from a test run. " +
      "Defaults to the most recent archived run. " +
      "Shows test names, pass/fail status, and whether they have captured output. " +
      "Use test_output to get detailed stdout/stderr for specific tests.",
    schema: {
      filter: z.enum(["all", "failed", "passed", "skipped"]).default("all").describe(
        "Filter results by status"
      ),
      className: z.string().optional().describe(
        "Filter by class name (partial match)"
      ),
      runId: z.string().optional().describe(
        'Run ID to fetch results from (e.g. "run-2024-01-15T10-30-00--MyTest"). ' +
        "Defaults to the most recent run. Use test_runs to list available runs."
      ),
    },
    handler: async ({ filter, className, runId }) => {
    let results;
    let effectiveRunId = runId || null;

    if (runId) {
      const summary = getRunSummary(runId);
      if (!summary) {
        return {
          content: [{
            type: "text",
            text: `❌ Run not found: ${runId}\n\nUse test_runs to list available runs.`
          }],
          isError: true,
        };
      }
      results = summary.tests;
    } else {
      // Try latest archived run, fall back to live workspace
      effectiveRunId = getLatestRunId();
      if (effectiveRunId) {
        const summary = getRunSummary(effectiveRunId);
        results = summary ? summary.tests : parseTestOutputs();
      } else {
        results = parseTestOutputs();
      }
    }

    if (!results || results.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No test output files found. Run tests first using the test tool."
        }],
      };
    }

    // Apply filters
    if (filter !== "all") {
      const statusMap = { failed: "FAILURE", passed: "SUCCESS", skipped: "SKIPPED" };
      results = results.filter(r => r.status === statusMap[filter]);
    }
    if (className) {
      results = results.filter(r => r.className.includes(className));
    }

    // Format output
    const lines = [
      `─── Test Results (${results.length} tests)${effectiveRunId ? ` [${effectiveRunId}]` : ""} ───`,
      "",
    ];

    const byStatus = { SUCCESS: 0, FAILURE: 0, SKIPPED: 0 };
    results.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    lines.push(`✅ Passed: ${byStatus.SUCCESS}  |  ❌ Failed: ${byStatus.FAILURE}  |  ⏭️  Skipped: ${byStatus.SKIPPED}`);
    lines.push("");

    for (const r of results) {
      const icon = r.status === "SUCCESS" ? "✅" : r.status === "FAILURE" ? "❌" : "⏭️";
      const output = r.hasOutput ? " [has output]" : "";
      const dbStats = r.hasDbStats ? " [has db-stats]" : "";
      const msg = r.failureMessage ? ` - ${r.failureMessage.substring(0, 80)}` : "";
      lines.push(`${icon} ${r.testId} (${r.duration}ms)${output}${dbStats}${msg}`);
    }

    if (results.some(r => r.status === "FAILURE")) {
      lines.push("");
      lines.push("💡 Use test_output({ testId: \"<testId>\" }) to see stdout/stderr for a specific test.");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
    },
  },

  {
    name: "test_output",
    description:
      "Get detailed stdout/stderr output for a specific test. " +
      "Use test_results first to find the testId.",
    schema: {
      testId: z.string().describe(
        'The full test ID (className.testName), e.g. "com.example.MyTest.testMethod"'
      ),
      runId: z.string().optional().describe(
        "Run ID to fetch output from. Defaults to the most recent run."
      ),
    },
    handler: async ({ testId, runId }) => {
    let data = null;
    const effectiveRunId = runId || getLatestRunId();

    // Try archived data first
    if (effectiveRunId) {
      data = getArchivedTestOutput(effectiveRunId, testId);
    }

    // Fall back to live workspace
    if (!data) {
      data = getTestOutput(testId);
    }

    if (!data) {
      // Try partial match in archive or live workspace
      let candidates = [];
      if (effectiveRunId) {
        const summary = getRunSummary(effectiveRunId);
        if (summary) {
          candidates = summary.tests.filter(r =>
            r.testId.includes(testId) || r.testName === testId
          );
        }
      }
      if (candidates.length === 0) {
        const allResults = parseTestOutputs();
        candidates = allResults.filter(r =>
          r.testId.includes(testId) || r.testName === testId
        );
      }

      if (candidates.length === 0) {
        return {
          content: [{
            type: "text",
            text: `❌ Test not found: ${testId}\n\nUse test_results to see available tests.`
          }],
          isError: true,
        };
      }

      if (candidates.length === 1) {
        if (effectiveRunId) {
          data = getArchivedTestOutput(effectiveRunId, candidates[0].testId);
        }
        if (!data) data = getTestOutput(candidates[0].testId);
        if (data) return formatTestOutputResult(data);
      }

      return {
        content: [{
          type: "text",
          text: `Multiple tests match "${testId}":\n\n${candidates.map(m => `  • ${m.testId}`).join("\n")}\n\nPlease specify the full testId.`
        }],
      };
    }

    return formatTestOutputResult(data);
    },
  },

  {
    name: "test_runs",
    description:
      "List all archived test runs (up to the last 10). " +
      "Shows summary info for each run including pass/fail counts and timing. " +
      "Use the runId with test_results or test_output to access specific runs.",
    schema: {},
    handler: async () => {
      const runs = listTestRuns();

      if (runs.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No archived test runs found. Run tests first using the test tool."
          }],
        };
      }

      const lines = [
        `─── Archived Test Runs (${runs.length}) ───`,
        "",
      ];

      for (const run of runs) {
        const date = new Date(run.startedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
        const duration = Math.round(run.durationMs / 1000);
        const icon = run.failures > 0 || run.errors > 0 ? "❌" : "✅";
        const filterStr = run.filter ? ` (filter: ${run.filter})` : "";
        const dbStr = run.hasDbStats ? " [db-stats]" : "";

        lines.push(`${icon} ${run.runId}${filterStr}`);
        lines.push(`   ${date}  |  ${duration}s  |  ${run.total} tests: ${run.passed} passed, ${run.failures} failed, ${run.errors} errors, ${run.skipped} skipped${dbStr}`);
        lines.push("");
      }

      lines.push("💡 Use test_results({ runId: \"<runId>\" }) to see results for a specific run.");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  },

  {
    name: "test_db_stats",
    description:
      "Get pg_stat_monitor database query statistics for a test or an entire test run. " +
      "Shows query execution counts, timing, and rows for each captured query. " +
      "Requires COLLECT_PG_STAT_MONITOR=true and a test run that captured stats.",
    schema: {
      runId: z.string().optional().describe(
        "Run ID to fetch stats from. Defaults to the most recent run."
      ),
      testId: z.string().optional().describe(
        "Filter to a specific test's db stats. " +
        'Uses the test method name for matching, e.g. "testCreateUser".'
      ),
    },
    handler: async ({ runId, testId }) => {
      const effectiveRunId = runId || getLatestRunId();

      if (!effectiveRunId) {
        return {
          content: [{
            type: "text",
            text: "No archived test runs found. Run tests first."
          }],
          isError: true,
        };
      }

      const dbStats = getArchivedDbStats(effectiveRunId, testId || null);

      if (dbStats.length === 0) {
        const msg = testId
          ? `No db-stats found for test "${testId}" in run ${effectiveRunId}.`
          : `No db-stats found in run ${effectiveRunId}.`;
        return {
          content: [{
            type: "text",
            text: `${msg}\n\nMake sure COLLECT_PG_STAT_MONITOR=true is set and the test code uses DatabaseTestHelper.`
          }],
        };
      }

      const lines = [
        `─── DB Stats [${effectiveRunId}]${testId ? ` (test: ${testId})` : ""} ───`,
        `${dbStats.length} stat file(s) found`,
        "",
      ];

      for (const { filename, stats } of dbStats) {
        lines.push(`── ${filename} ──`);

        if (!Array.isArray(stats) || stats.length === 0) {
          lines.push("  (no queries captured)");
          lines.push("");
          continue;
        }

        // Separate baseline/setup queries from application queries
        const baseline = [];
        const appQueries = [];
        for (const q of stats) {
          if (/^(CREATE\s+(TABLE|INDEX)|DROP\s+(TABLE|INDEX)|ALTER\s+TABLE)/i.test(q.query || "")
              || /SELECT\s+1\s+FROM\s+\S+\s+LIMIT\s+1/i.test(q.query || "")) {
            baseline.push(q);
          } else {
            appQueries.push(q);
          }
        }

        // Sort by total_exec_time descending (most expensive first)
        const sorted = [...appQueries].sort((a, b) => (b.total_exec_time || 0) - (a.total_exec_time || 0));

        const limit = 20;
        for (const q of sorted.slice(0, limit)) {
          const query = (q.query || "unknown").substring(0, 120);
          lines.push(`  calls: ${q.calls || 0}  |  total: ${(q.total_exec_time || 0).toFixed(1)}ms  |  mean: ${(q.mean_exec_time || 0).toFixed(2)}ms  |  rows: ${q.rows || 0}`);
          lines.push(`  ${query}`);
          lines.push("");
        }

        if (sorted.length > limit) {
          lines.push(`  ... and ${sorted.length - limit} more queries`);
          lines.push("");
        }

        // Summarize filtered baseline queries
        if (baseline.length > 0) {
          const totalCalls = baseline.reduce((s, q) => s + (q.calls || 0), 0);
          const totalTime = baseline.reduce((s, q) => s + (q.total_exec_time || 0), 0);
          lines.push(`  [baseline] ${baseline.length} setup queries hidden (DDL + tenant checks): ${totalCalls} calls, ${totalTime.toFixed(1)}ms total`);
          lines.push("");
        }
      }

      return {
        content: [{ type: "text", text: truncate(lines.join("\n")) }],
      };
    },
  },
];

// ── MCP server definition ───────────────────────────────────────────

const server = new McpServer({
  name: "java-build-tools",
  version: "1.0.0",
});

for (const t of TOOLS) {
  server.tool(t.name, t.description, t.schema, t.handler);
}

// Lookup map for the HTTP API
const toolMap = new Map(TOOLS.map(t => [t.name, t]));

function formatTestOutputResult(data) {
  const lines = [
    `─── Test Output: ${data.testId} ───`,
    "",
    `Status: ${data.resultType === "SUCCESS" ? "✅ PASSED" : data.resultType === "FAILURE" ? "❌ FAILED" : "⏭️ SKIPPED"}`,
    `Duration: ${data.endTime - data.startTime}ms`,
    "",
  ];

  if (data.failureMessage) {
    lines.push("─── Failure Message ───");
    lines.push(data.failureMessage);
    lines.push("");
  }

  if (data.failureTrace && data.failureTrace.length > 0) {
    lines.push("─── Stack Trace ───");
    lines.push(data.failureTrace.join("\n"));
    lines.push("");
  }

  if (data.stdout) {
    lines.push("─── stdout ───");
    lines.push(data.stdout);
    lines.push("");
  } else {
    lines.push("─── stdout ───");
    lines.push("(no output)");
    lines.push("");
  }

  if (data.stderr) {
    lines.push("─── stderr ───");
    lines.push(data.stderr);
  } else {
    lines.push("─── stderr ───");
    lines.push("(no output)");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// ── Start ───────────────────────────────────────────────────────────

log("Starting java-build-tools MCP server …");

if (MCP_TRANSPORT === "stdio") {
  log("Using stdio transport");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Connected — ready for requests.");
} else {
  log(`Using SSE transport on port ${MCP_PORT}`);

  const transports = new Map();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "sse" }));
      return;
    }

    if (url.pathname === "/sse") {
      log("New SSE connection");
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      log(`Session created: ${transport.sessionId}`);

      res.on("close", () => {
        log(`SSE connection closed: ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      });

      // Close any existing transport before connecting the new one.
      // The MCP SDK only allows one transport per protocol instance.
      try { await server.close(); } catch (_) { /* no-op if not connected */ }
      await server.connect(transport);
      return;
    }

    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = transports.get(sessionId);

      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
        return;
      }

      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          await transport.handlePostMessage(req, res, body);
        } catch (err) {
          log(`Error handling message: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      });
      return;
    }

    // ── HTTP API (stateless, supports multiple concurrent clients) ──

    if (url.pathname === "/api/tools" && req.method === "GET") {
      const toolList = TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(z.object(t.schema)),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(toolList));
      return;
    }

    if (url.pathname === "/api/call" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const { tool: toolName, arguments: args } = JSON.parse(body);

          const toolDef = toolMap.get(toolName);
          if (!toolDef) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
            return;
          }

          const zodObj = z.object(toolDef.schema);
          const parseResult = zodObj.safeParse(args || {});
          if (!parseResult.success) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "Invalid arguments",
              details: parseResult.error.issues,
            }));
            return;
          }

          const result = await toolDef.handler(parseResult.data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          log(`[/api/call] Error: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(MCP_PORT, "0.0.0.0", () => {
    log(`HTTP server listening on http://0.0.0.0:${MCP_PORT}`);
    log("Endpoints:");
    log("  GET  /sse        – SSE connection (MCP protocol)");
    log("  POST /messages   – SSE message endpoint");
    log("  GET  /api/tools  – List tools (HTTP API)");
    log("  POST /api/call   – Call a tool (HTTP API)");
    log("  GET  /health     – Health check");
  });
}
