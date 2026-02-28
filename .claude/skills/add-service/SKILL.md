---
disable-model-invocation: true
---

# /add-service — System Service Management

Generates service configuration files for running mdclaw as a persistent background service with auto-restart on crash and auto-start on boot.

## Prerequisites

- mdclaw must be fully set up (`/setup` completed)
- `.env` must exist with all required configuration

## Platform detection

Detect the platform and generate the appropriate service file:

- **macOS** → launchd plist
- **Linux** → systemd user service
- **WSL** → systemd user service (same as Linux)

## Files to create

| File | Purpose |
|------|---------|
| `com.mdclaw.plist` | macOS launchd service definition |
| `mdclaw.service` | Linux systemd user service definition |
| `scripts/install-service.sh` | Service installation script |
| `scripts/uninstall-service.sh` | Service removal script |

## macOS launchd plist (`com.mdclaw.plist`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mdclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>{NODE_PATH}</string>
        <string>{PROJECT_DIR}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{PROJECT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{PROJECT_DIR}/logs/mdclaw.log</string>
    <key>StandardErrorPath</key>
    <string>{PROJECT_DIR}/logs/mdclaw.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
```

Replace `{NODE_PATH}` with `which node` output and `{PROJECT_DIR}` with the absolute project path.

## Linux systemd service (`mdclaw.service`)

```ini
[Unit]
Description=mdclaw AI Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={PROJECT_DIR}
ExecStart={NODE_PATH} {PROJECT_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=append:{PROJECT_DIR}/logs/mdclaw.log
StandardError=append:{PROJECT_DIR}/logs/mdclaw.error.log
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

## scripts/install-service.sh

```bash
#!/bin/bash
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$PROJECT_DIR/logs"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: install launchd plist
    cp "$PROJECT_DIR/com.mdclaw.plist" ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.mdclaw.plist
    echo "Service installed. mdclaw will start automatically."
    echo "  Start now:  launchctl start com.mdclaw"
    echo "  Stop:       launchctl stop com.mdclaw"
    echo "  Logs:       tail -f $PROJECT_DIR/logs/mdclaw.log"
else
    # Linux: install systemd user service
    mkdir -p ~/.config/systemd/user/
    cp "$PROJECT_DIR/mdclaw.service" ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable mdclaw
    systemctl --user start mdclaw
    echo "Service installed and started."
    echo "  Status:  systemctl --user status mdclaw"
    echo "  Stop:    systemctl --user stop mdclaw"
    echo "  Logs:    tail -f $PROJECT_DIR/logs/mdclaw.log"
fi
```

## scripts/uninstall-service.sh

```bash
#!/bin/bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
    launchctl unload ~/Library/LaunchAgents/com.mdclaw.plist 2>/dev/null || true
    rm -f ~/Library/LaunchAgents/com.mdclaw.plist
    echo "Service uninstalled."
else
    systemctl --user stop mdclaw 2>/dev/null || true
    systemctl --user disable mdclaw 2>/dev/null || true
    rm -f ~/.config/systemd/user/mdclaw.service
    systemctl --user daemon-reload
    echo "Service uninstalled."
fi
```

## Behavioral requirements

1. Detect platform via `process.platform` or `$OSTYPE`
2. Resolve `{NODE_PATH}` via `which node`
3. Resolve `{PROJECT_DIR}` via `pwd` or `process.cwd()`
4. Create `logs/` directory
5. Build project first: `npm run build` (service runs compiled JS, not tsx)
6. Generate the appropriate service file with resolved paths
7. Create install/uninstall scripts with `chmod +x`

## Verification

```bash
# macOS
launchctl list | grep mdclaw

# Linux
systemctl --user status mdclaw

# Both
tail -f logs/mdclaw.log
```
