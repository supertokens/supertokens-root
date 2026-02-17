#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════
// Simple MCP Client for testing java-build-tools server
//
// Uses the HTTP API directly (no SSE connection needed).
//
// Usage:
//   ./scripts/mcp-client.mjs compile [--clean]
//   ./scripts/mcp-client.mjs test [--filter "MyTest"] [--clean] [--skip-build]
//   ./scripts/mcp-client.mjs lint [--task checkstyleMain]
//   ./scripts/mcp-client.mjs setup [--no-skip-build] [--cicd]
//   ./scripts/mcp-client.mjs clean [--silent]
//   ./scripts/mcp-client.mjs status <taskId>
//   ./scripts/mcp-client.mjs list
//   ./scripts/mcp-client.mjs cancel <taskId>
//   ./scripts/mcp-client.mjs results [--filter all|failed|passed|skipped] [--class <name>] [--run-id <runId>]
//   ./scripts/mcp-client.mjs output <testId> [--run-id <runId>]
//   ./scripts/mcp-client.mjs runs
//   ./scripts/mcp-client.mjs db-stats [--test <testId>] [--run-id <runId>]
// ═══════════════════════════════════════════════════════════════════════

import http from "node:http";

const API_BASE = process.env.MCP_API_URL || "http://localhost:3000";

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const payload = body != null ? JSON.stringify(body) : null;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(0);
    if (payload) req.write(payload);
    req.end();
  });
}

async function callTool(name, args = {}) {
  const result = await httpRequest("POST", "/api/call", {
    tool: name,
    arguments: args,
  });
  if (result.isError) {
    if (result.content) {
      for (const item of result.content) {
        if (item.type === "text") console.error(item.text);
      }
    }
    process.exit(1);
  }
  return result;
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(`
Usage:
  mcp-client.mjs compile [--clean]
  mcp-client.mjs test [--filter <pattern>] [--clean] [--skip-build]
  mcp-client.mjs lint [--task <taskName>]
  mcp-client.mjs setup [--no-skip-build] [--cicd]    Set up test environment
  mcp-client.mjs clean [--silent]                    Clean test environment
  mcp-client.mjs status <taskId>
  mcp-client.mjs list
  mcp-client.mjs cancel <taskId>
  mcp-client.mjs results [--filter all|failed|passed|skipped] [--class <name>] [--run-id <runId>]
  mcp-client.mjs output <testId> [--run-id <runId>]  Get stdout/stderr for a test
  mcp-client.mjs runs                                List archived test runs
  mcp-client.mjs db-stats [--test <testId>] [--run-id <runId>]  Get pg_stat_monitor stats
`);
    process.exit(0);
  }

  let result;

  switch (command) {
    case "compile": {
      const clean = args.includes("--clean");
      result = await callTool("compile", { clean });
      break;
    }

    case "test": {
      const filterIdx = args.indexOf("--filter");
      const filter = filterIdx >= 0 ? args[filterIdx + 1] : undefined;
      const clean = args.includes("--clean");
      const skipBuild = args.includes("--skip-build");
      result = await callTool("test", { filter, clean, skipBuild });
      break;
    }

    case "setup": {
      const skipBuild = !args.includes("--no-skip-build");
      const cicd = args.includes("--cicd");
      result = await callTool("setup_test_env", { skipBuild, cicd });
      break;
    }

    case "clean": {
      const silent = args.includes("--silent");
      result = await callTool("clean_test_env", { silent });
      break;
    }

    case "lint": {
      const taskIdx = args.indexOf("--task");
      const task = taskIdx >= 0 ? args[taskIdx + 1] : undefined;
      result = await callTool("lint", { task });
      break;
    }

    case "status": {
      const taskId = args[0];
      if (!taskId) {
        console.error("Usage: mcp-client.mjs status <taskId>");
        process.exit(1);
      }
      result = await callTool("task_status", { taskId });
      break;
    }

    case "list": {
      result = await callTool("task_list", {});
      break;
    }

    case "cancel": {
      const taskId = args[0];
      if (!taskId) {
        console.error("Usage: mcp-client.mjs cancel <taskId>");
        process.exit(1);
      }
      result = await callTool("task_cancel", { taskId });
      break;
    }

    case "results": {
      const filterIdx = args.indexOf("--filter");
      const filter = filterIdx >= 0 ? args[filterIdx + 1] : "all";
      const classIdx = args.indexOf("--class");
      const className = classIdx >= 0 ? args[classIdx + 1] : undefined;
      const runIdIdx = args.indexOf("--run-id");
      const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : undefined;
      result = await callTool("test_results", { filter, className, runId });
      break;
    }

    case "output": {
      const runIdIdx = args.indexOf("--run-id");
      const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : undefined;
      // testId is the first positional arg (not a flag)
      const testId = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1]?.startsWith("--")));
      if (!testId) {
        console.error("Usage: mcp-client.mjs output <testId> [--run-id <runId>]");
        process.exit(1);
      }
      result = await callTool("test_output", { testId, runId });
      break;
    }

    case "runs": {
      result = await callTool("test_runs", {});
      break;
    }

    case "db-stats": {
      const testIdx = args.indexOf("--test");
      const testId = testIdx >= 0 ? args[testIdx + 1] : undefined;
      const runIdIdx = args.indexOf("--run-id");
      const runId = runIdIdx >= 0 ? args[runIdIdx + 1] : undefined;
      result = await callTool("test_db_stats", { testId, runId });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  // Print result
  if (result?.content) {
    for (const item of result.content) {
      if (item.type === "text") {
        console.log(item.text);
      }
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
