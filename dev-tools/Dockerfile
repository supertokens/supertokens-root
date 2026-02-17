FROM eclipse-temurin:21-jdk-jammy

LABEL maintainer="java-mcp-docker"
LABEL description="MCP server exposing Java/Gradle build tools (compile, test, lint)"

# ── System dependencies ──────────────────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        unzip \
        ca-certificates \
        gnupg && \
    # Node.js 20.x for the MCP server runtime
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    # Cleanup
    apt-get purge -y gnupg && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ── Gradle (fallback when project has no wrapper) ────────────────────
ARG GRADLE_VERSION=8.11.1
RUN curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
        -o /tmp/gradle.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    ln -s "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle && \
    rm /tmp/gradle.zip

# ── Non-root user ────────────────────────────────────────────────────
RUN groupadd -r builder && \
    useradd -r -g builder -m -d /home/builder -s /bin/bash builder

# ── MCP server ───────────────────────────────────────────────────────
WORKDIR /opt/mcp-server
COPY mcp-server/package.json ./
RUN npm install --omit=dev && \
    chown -R builder:builder /opt/mcp-server

COPY --chown=builder:builder mcp-server/server.mjs mcp-server/gradle-init.gradle ./

# ── Runtime setup ────────────────────────────────────────────────────
USER builder
RUN mkdir -p /home/builder/.gradle

WORKDIR /workspace

# MCP server - defaults to SSE transport on port 3000
# Set MCP_TRANSPORT=stdio for legacy stdin/stdout mode
EXPOSE 3000
ENTRYPOINT ["node", "/opt/mcp-server/server.mjs"]
