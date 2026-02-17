# Java Build Tools — MCP Server in Docker

An MCP (Model Context Protocol) server that exposes **compile**, **test**, and **lint** tools for a Gradle/Java project. Runs inside Docker for isolation, designed for use with **Claude Desktop** and **Cowork**.

## Architecture

```
┌─────────────────────────────────────────┐
│  Claude Desktop / Cowork                │
│    ↕ stdio (JSON-RPC)                   │
│  ┌───────────────────────────────────┐  │
│  │  Docker container                 │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Node.js MCP Server         │  │  │
│  │  │  (server.mjs)               │  │  │
│  │  │    → spawns gradle          │  │  │
│  │  └─────────────────────────────┘  │  │
│  │  Java 21 JDK + Gradle 8.11       │  │
│  │  /workspace ← bind mount         │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Build the image

```bash
cd supertokens-root
chmod +x dev-tools/manage.sh
./dev-tools/manage.sh build
```

### 2. Start test databases (if your tests need them)

```bash
./dev-tools/manage.sh up
./dev-tools/manage.sh status   # shows network name + connection strings
```

### 3. Test the MCP server manually (optional)

```bash
# Quick smoke test — should print MCP init handshake on stdout
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' \
  | docker run -i --rm -v /path/to/supertokens-root:/workspace java-mcp-server
```

### 4. Configure Claude Desktop

Edit your Claude Desktop config file:

| OS    | Path                                                                |
|-------|---------------------------------------------------------------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json`   |
| Linux | `~/.config/Claude/claude_desktop_config.json`                       |

See `dev-tools/claude_desktop_config.example.jsonc` for the full annotated version. Here's the minimal config **without** test database networking:

```jsonc
{
  "mcpServers": {
    "java-build": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--memory=4g",
        "--cpus=4",
        "--pids-limit=512",
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=1g",
        "-v", "/Users/you/projects/supertokens-root:/workspace",
        "-v", "java-mcp-gradle-cache:/home/builder/.gradle",
        "java-mcp-server"
      ]
    }
  }
}
```

To connect tests to the compose databases, add these args (see the example config for the full version):

```jsonc
        "--network=supertokens-mcp_default",
        "-e", "TEST_PG_URL=jdbc:postgresql://pg:5432/supertokens_test?user=test&password=test",
```

> **Edit** the `/Users/you/projects/supertokens-root` path to your actual project directory — this same folder should be what you give Cowork access to.

### 5. Restart Claude Desktop

Claude (and Cowork) will now have access to the `compile`, `test`, and `lint` tools.

---

## Tools

### `compile`

Full compilation of main + test sources (`classes` + `testClasses`).

| Parameter | Type    | Default | Description                         |
|-----------|---------|---------|-------------------------------------|
| `clean`   | boolean | false   | Run `gradle clean` before compiling |

**Returns:** Success/failure status with full compiler output, including error messages with file/line references.

### `test`

Run tests with optional filtering.

| Parameter | Type   | Default | Description                                    |
|-----------|--------|---------|------------------------------------------------|
| `filter`  | string | —       | Gradle `--tests` pattern (see examples below)  |
| `clean`   | boolean| false   | Run `gradle clean` before testing              |

Filter examples:
- `"com.example.MyTest"` — all methods in a specific class
- `"*IntegrationTest"` — all classes ending in IntegrationTest
- `"com.example.MyTest.specificMethod"` — single method
- `"*.service.*"` — all tests in a package

**Returns:** Structured summary (total/passed/failed/errors/skipped) parsed from JUnit XML reports, individual failure details with messages and stack traces, and the raw Gradle output.

### `lint`

Run linting/formatting checks. Auto-detects configured plugins from `build.gradle`:

| Plugin      | Task auto-detected         |
|-------------|----------------------------|
| Checkstyle  | `checkstyleMain`, `checkstyleTest` |
| Spotless    | `spotlessCheck`            |
| PMD         | `pmdMain`                  |
| SpotBugs    | `spotbugsMain`             |

| Parameter | Type   | Default      | Description                              |
|-----------|--------|--------------|------------------------------------------|
| `task`    | string | auto-detect  | Explicit Gradle task name to run instead |

**Returns:** Lint output with violation details.

---

## Test Infrastructure (Docker Compose)

If your tests need external services (PostgreSQL, MySQL, Redis, etc.), run them alongside the MCP container via Docker Compose rather than trying to do Docker-in-Docker.

### How it works

```
┌─────────────────────────────────────────────────┐
│  Docker network: supertokens-mcp_default        │
│                                                 │
│  ┌──────────────┐       ┌────────────────────┐  │
│  │  PostgreSQL   │◄──────│  MCP container     │  │
│  │  hostname: pg │ :5432 │  (Claude Desktop)  │  │
│  └──────────────┘       │                    │  │
│                          │  gradle test       │  │
│  ┌──────────────┐       │   → connects to    │  │
│  │  MySQL (opt)  │◄──────│     pg:5432        │  │
│  │  hostname:    │ :3306 │     mysql:3306     │  │
│  │  mysql        │       └────────────────────┘  │
│  └──────────────┘                               │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │  /workspace (bind mount)             │       │
│  │  ← same folder shared with Cowork   │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
```

Note: The `docker-compose.yml` lives at the project root (`supertokens-root/docker-compose.yml`).

### Setup

```bash
cd supertokens-root

# 1. Build the MCP server image
./dev-tools/manage.sh build

# 2. Start test databases
./dev-tools/manage.sh up

# 3. Check everything is healthy
./dev-tools/manage.sh status
```

The `status` command prints the Docker network name and connection strings you need.

### Connecting tests to the databases

The MCP container receives database coordinates as environment variables (see `dev-tools/claude_desktop_config.example.jsonc`). Your tests can read them however suits your project:

**Option A — `System.getenv()` in test code:**

```java
String url = System.getenv("TEST_PG_URL");
// jdbc:postgresql://pg:5432/supertokens_test?user=test&password=test
```

**Option B — `gradle.properties` with env fallback:**

```properties
# gradle.properties (committed, with safe defaults for CI)
test.pg.url=jdbc:postgresql://localhost:5432/supertokens_test
```

```groovy
// build.gradle
test {
    def pgUrl = System.getenv("TEST_PG_URL") ?: project.findProperty("test.pg.url")
    systemProperty "db.url", pgUrl
}
```

**Option C — Spring/config-file based:** set `spring.datasource.url` via env var in the usual way.

### Lifecycle

```bash
./dev-tools/manage.sh up       # start databases (idempotent)
./dev-tools/manage.sh down     # stop databases, keep data
./dev-tools/manage.sh reset    # stop databases, wipe all data (fresh init on next up)
./dev-tools/manage.sh logs pg  # tail PostgreSQL logs
```

### Adding MySQL, Redis, or other services

Uncomment the relevant blocks in `docker-compose.yml`, add the corresponding `-e` vars to your Claude Desktop config, and restart both:

```bash
./dev-tools/manage.sh up         # picks up compose changes
# restart Claude Desktop to pick up config changes
```

---

## Security

The container is locked down by default. Here's what each measure does and what else you might consider:

### Applied by default (in the recommended config above)

| Measure | What it does |
|---|---|
| `--cap-drop=ALL` | Drops every Linux capability (no mount, no raw sockets, no ptrace, etc.) |
| `--security-opt=no-new-privileges` | Prevents privilege escalation via setuid/setgid binaries |
| `--read-only` | Root filesystem is immutable; writes only possible in tmpfs and mounted volumes |
| `--tmpfs /tmp` | Writable temp directory with `noexec,nosuid` — Gradle needs this for scratch files |
| `--memory=4g` | Hard memory ceiling; OOM-killed if exceeded |
| `--cpus=4` | CPU throttle so builds can't starve the host |
| `--pids-limit=512` | Prevents fork bombs |
| Non-root user | Process runs as `builder` (uid 1000), not root |
| Single bind mount | Only `/workspace` is accessible — no access to host root, home, or other dirs |

### Optional: disable networking

If your project's dependencies are already cached (or you pre-populate the Gradle cache volume), you can fully isolate the container from the network:

```jsonc
"args": [
  "run", "-i", "--rm",
  "--network=none",    // ← add this
  // ... rest of flags
]
```

**Trade-off:** Gradle cannot resolve dependencies with `--network=none`. You'd need to do an initial `docker run` with networking to warm the cache:

```bash
docker run --rm \
  -v /path/to/project:/workspace \
  -v java-mcp-gradle-cache:/home/builder/.gradle \
  java-mcp-server \
  sh -c "cd /workspace && ./gradlew dependencies --no-daemon"
```

Then switch to `--network=none` for normal use.

> **Note:** `--network=none` is incompatible with the compose-based test databases.
> When using `--network=supertokens-mcp_default`, the MCP container can reach
> the database containers *and* the internet (for dependency resolution). This is
> the expected trade-off — the container is still sandboxed by `--cap-drop=ALL`,
> read-only root FS, and non-root user. It just has network access.

### Optional: read-only project mount

If Cowork handles all file editing and you only need the container for building/testing:

```
"-v", "/path/to/project:/workspace:ro"
```

**Trade-off:** Gradle writes to `build/`, `.gradle/`, etc. inside the project. You'd need to overlay those with tmpfs mounts or accept that builds fail. In practice, read-write is needed for Gradle to function, but the non-root user + `--cap-drop=ALL` already limits the blast radius.

### What about secrets?

Since you mentioned nothing sensitive lives in the folder, the above is sufficient. If that changes:

- Never mount `~/.ssh`, `~/.aws`, `~/.config` or similar into the container
- Don't pass API keys / tokens via environment variables to the container
- If your `build.gradle` references private artifact repositories, use a Gradle init script inside the cache volume rather than embedding credentials in the project

---

## Configuration

All tunable via environment variables passed to the container:

| Variable | Default | Description |
|---|---|---|
| `JAVA_MCP_WORKSPACE` | `/workspace` | Path inside container where the project is mounted |
| `JAVA_MCP_COMPILE_TIMEOUT_SECS` | `300` | Compile timeout in seconds |
| `JAVA_MCP_TEST_TIMEOUT_SECS` | `600` | Test timeout in seconds |
| `JAVA_MCP_LINT_TIMEOUT_SECS` | `300` | Lint timeout in seconds |
| `JAVA_MCP_MAX_OUTPUT_CHARS` | `60000` | Max output chars (truncated from middle) |

Example with custom timeout:

```jsonc
"args": [
  "run", "-i", "--rm",
  "-e", "JAVA_MCP_TEST_TIMEOUT_SECS=900",
  // ... rest of flags
]
```

---

## Gradle Cache

The named volume `java-mcp-gradle-cache` persists downloaded dependencies across container restarts. Without it, every new container re-downloads everything.

```bash
# Inspect the cache
docker volume inspect java-mcp-gradle-cache

# Nuke it if corrupted
docker volume rm java-mcp-gradle-cache
```

---

## Troubleshooting

### "No Gradle project detected"

The `/workspace` mount is empty or doesn't contain `build.gradle` / `settings.gradle`. Check your `-v` path.

### Gradle wrapper permission error

The server automatically `chmod +x`es `gradlew` if it isn't executable. If you still hit issues, check the file isn't corrupted (Windows line endings can cause `bad interpreter` errors — run `dos2unix gradlew` on the host).

### Dependency resolution fails

First run needs network access to download dependencies. Make sure you're not using `--network=none` until the Gradle cache is warm.

### Container runs out of memory

Increase `--memory` or set `org.gradle.jvmargs=-Xmx2g` in `gradle.properties`.

### Tests time out

Increase `JAVA_MCP_TEST_TIMEOUT_SECS`. Default is 600s (10 min).
