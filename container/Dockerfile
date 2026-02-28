FROM node:22-slim

# Install Chromium and fonts for future web browsing capability
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI and agent-browser globally
RUN npm install -g @anthropic-ai/claude-code agent-browser

# Copy and build agent-runner
COPY container/agent-runner/ /agent-runner/
WORKDIR /agent-runner
RUN npm install && npm run build

# Set up working directory
WORKDIR /app

# Run as non-root node user (uid 1000)
RUN groupmod -g 1000 node && usermod -u 1000 -g 1000 node

USER node

ENTRYPOINT ["node", "/agent-runner/dist/index.js"]
