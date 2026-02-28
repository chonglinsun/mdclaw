# Agent Browser — Web Browsing Automation

You have access to a headless Chromium browser via the `agent-browser` CLI tool. Use it for web research, data extraction, form filling, and browser-based automation.

## Quick Start

```bash
# Open a URL
agent-browser open "https://example.com"

# Take a snapshot of the page (get page structure)
agent-browser snapshot

# Click an element
agent-browser click "Login button"

# Fill a form field
agent-browser fill "Email input" "user@example.com"

# Get page text content
agent-browser text

# Take a screenshot
agent-browser screenshot /tmp/page.png
```

## Navigation

| Command | Description |
|---------|-------------|
| `agent-browser open <url>` | Navigate to URL |
| `agent-browser back` | Go back |
| `agent-browser forward` | Go forward |
| `agent-browser reload` | Reload page |
| `agent-browser close` | Close browser |

## Page Analysis

| Command | Description |
|---------|-------------|
| `agent-browser snapshot` | Get page structure (interactive elements, headings, links) |
| `agent-browser snapshot --interactive` | Show only interactive elements |
| `agent-browser snapshot --compact` | Condensed output |
| `agent-browser text` | Extract all visible text |
| `agent-browser html <selector>` | Get HTML of matching elements |
| `agent-browser title` | Get page title |
| `agent-browser url` | Get current URL |

## Interactions

| Command | Description |
|---------|-------------|
| `agent-browser click <target>` | Click element (by text, aria label, or ref) |
| `agent-browser fill <target> <value>` | Fill input field |
| `agent-browser type <target> <text>` | Type text character by character |
| `agent-browser hover <target>` | Hover over element |
| `agent-browser check <target>` | Toggle checkbox |
| `agent-browser select <target> <value>` | Select dropdown option |
| `agent-browser upload <target> <filepath>` | Upload file to input |

## Data Extraction

| Command | Description |
|---------|-------------|
| `agent-browser text <selector>` | Get text of matching elements |
| `agent-browser value <selector>` | Get value of input elements |
| `agent-browser attribute <selector> <attr>` | Get attribute value |
| `agent-browser screenshot <path>` | Save screenshot as PNG |
| `agent-browser pdf <path>` | Export page as PDF |

## Waiting

| Command | Description |
|---------|-------------|
| `agent-browser wait element <selector>` | Wait for element to appear |
| `agent-browser wait network` | Wait for network to be idle |
| `agent-browser wait text <pattern>` | Wait for text to appear on page |
| `agent-browser wait url <pattern>` | Wait for URL to match pattern |

## Authentication Persistence

```bash
# Save auth state (cookies, localStorage) after logging in
agent-browser auth save /workspace/group/browser-auth/

# Load saved auth state before navigating
agent-browser auth load /workspace/group/browser-auth/
```

Auth state is saved per-group in the mounted data directory, so login sessions persist across container runs.

## Element Targeting

Elements can be targeted by:
- **Text content:** `"Login"`, `"Submit button"`
- **Aria labels:** `"Search input"`, `"Navigation menu"`
- **CSS selectors:** `"#login-form input[type=email]"`
- **Element references:** `ref:e42` (from snapshot output)

Prefer semantic targets (text, aria labels) over CSS selectors for resilience.

## Tips

- Always run `snapshot` first to understand the page structure
- Use `wait network` after navigation to ensure the page is fully loaded
- Save auth state after login to avoid re-authentication
- Use `screenshot` for debugging when interactions don't work as expected
- For SPAs, use `wait element` instead of `wait network` since the network may stay active
