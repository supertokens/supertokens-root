#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════
// MCP Stdio-to-HTTP Proxy
//
// Claude Desktop launches this script. It reads MCP JSON-RPC from stdin,
// translates to HTTP API calls against the MCP server, and writes
// JSON-RPC responses to stdout.
//
// No persistent SSE connection — fully stateless on the backend side,
// so multiple clients can use the server concurrently.
// ═══════════════════════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const API_BASE = process.env.MCP_API_URL || "http://localhost:3000";
const DEBUG = process.env.MCP_DEBUG === "true";
const LOG_FILE = process.env.MCP_LOG_FILE || "/tmp/mcp-proxy.log";

let logStream = null;

if (DEBUG) {
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  logStream.write(`\n${"=".repeat(60)}\n[${new Date().toISOString()}] MCP proxy started (PID ${process.pid})\n${"=".repeat(60)}\n`);
}

function debugLog(direction, data) {
  if (!logStream) return;
  const ts = new Date().toISOString();
  logStream.write(`[${ts}] ${direction} ${data}\n`);
}

function log(msg) {
  process.stderr.write(`[mcp-proxy] ${msg}\n`);
  debugLog("LOG", msg);
}

// ── HTTP helper ──────────────────────────────────────────────────────

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const client = url.protocol === "https:" ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;

    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
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
        res.setEncoding("utf8");
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
    req.setTimeout(0); // no timeout for potentially long tool calls
    if (payload) req.write(payload);
    req.end();
  });
}

// ── MCP message handler ─────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Handle initialize locally — proxy IS the MCP server from Claude's perspective
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "java-build-tools", version: "1.0.0" },
      },
    };
  }

  // Notifications have no response
  if (method === "notifications/initialized") {
    return null;
  }

  // Forward tools/list → GET /api/tools
  if (method === "tools/list") {
    const tools = await httpRequest("GET", "/api/tools");
    return {
      jsonrpc: "2.0",
      id,
      result: { tools },
    };
  }

  // Forward tools/call → POST /api/call
  if (method === "tools/call") {
    const result = await httpRequest("POST", "/api/call", {
      tool: params.name,
      arguments: params.arguments || {},
    });
    return {
      jsonrpc: "2.0",
      id,
      result,
    };
  }

  // Unknown method
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ── Stdin reader ─────────────────────────────────────────────────────

log(`Proxy started, API backend: ${API_BASE}`);

process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    debugLog("STDIN", line);

    try {
      const msg = JSON.parse(line);
      handleMessage(msg)
        .then((response) => {
          if (response) {
            const out = JSON.stringify(response);
            debugLog("STDOUT", out);
            process.stdout.write(out + "\n");
          }
        })
        .catch((err) => {
          log(`Error handling ${msg.method}: ${err.message}`);
          if (msg.id !== undefined) {
            const errResp = JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32603, message: err.message },
            });
            process.stdout.write(errResp + "\n");
          }
        });
    } catch (e) {
      log(`Invalid JSON from stdin: ${e.message}`);
    }
  }
});

process.stdin.on("end", () => {
  log("stdin closed");
  process.exit(0);
});

// ── Shutdown ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  log("SIGTERM received");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("SIGINT received");
  process.exit(0);
});
