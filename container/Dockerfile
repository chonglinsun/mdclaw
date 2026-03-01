FROM node:22-slim

# Install Chromium, its runtime dependencies, and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    fonts-liberation \
    fonts-noto-color-emoji \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI and agent-browser globally
RUN npm install -g @anthropic-ai/claude-code agent-browser

# Copy and build agent-runner
COPY container/agent-runner/ /agent-runner/
WORKDIR /agent-runner
RUN npm install && npm run build

# Set up working directory
WORKDIR /app

# Run as non-root node user (uid 1000) with writable home for Claude Code session data
RUN groupmod -g 1000 node && usermod -u 1000 -g 1000 node \
    && chmod 777 /home/node

USER node

ENTRYPOINT ["node", "/agent-runner/dist/index.js"]
