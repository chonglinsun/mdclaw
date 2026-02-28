# X/Twitter Browser Automation

You can interact with X (Twitter) using the `agent-browser` tool and headless Chromium.

## Authentication

1. Check for saved auth: `agent-browser auth load /workspace/group/x-auth/`
2. If no saved state, navigate to login:
   ```bash
   agent-browser open "https://x.com/login"
   agent-browser wait element "input[name='text']"
   agent-browser fill "input[name='text']" "$X_USERNAME"
   agent-browser click "Next"
   agent-browser wait element "input[name='password']"
   agent-browser fill "input[name='password']" "$X_PASSWORD"
   agent-browser click "Log in"
   agent-browser wait url "https://x.com/home"
   agent-browser auth save /workspace/group/x-auth/
   ```

## Post a tweet

```bash
agent-browser open "https://x.com/compose/tweet"
agent-browser wait element "[data-testid='tweetTextarea_0']"
agent-browser fill "[data-testid='tweetTextarea_0']" "Your tweet text here"
agent-browser click "[data-testid='tweetButton']"
agent-browser wait network
```

## Reply to a tweet

```bash
agent-browser open "https://x.com/{user}/status/{tweetId}"
agent-browser wait element "[data-testid='reply']"
agent-browser click "[data-testid='reply']"
agent-browser fill "[data-testid='tweetTextarea_0']" "Your reply here"
agent-browser click "[data-testid='tweetButton']"
```

## Like a tweet

```bash
agent-browser open "https://x.com/{user}/status/{tweetId}"
agent-browser click "[data-testid='like']"
```

## Retweet

```bash
agent-browser open "https://x.com/{user}/status/{tweetId}"
agent-browser click "[data-testid='retweet']"
agent-browser click "[data-testid='retweetConfirm']"
```

## Quote tweet

```bash
agent-browser open "https://x.com/{user}/status/{tweetId}"
agent-browser click "[data-testid='retweet']"
agent-browser click "Quote"
agent-browser fill "[data-testid='tweetTextarea_0']" "Your commentary"
agent-browser click "[data-testid='tweetButton']"
```

## Search

```bash
agent-browser open "https://x.com/search?q=your+query&src=typed_query&f=live"
agent-browser wait element "[data-testid='tweet']"
agent-browser text "[data-testid='tweetText']"
```

## Read timeline

```bash
agent-browser open "https://x.com/home"
agent-browser wait element "[data-testid='tweet']"
agent-browser text "[data-testid='tweetText']"
```

## Tips

- Keep tweets under 280 characters
- Wait for network idle after each action
- Save auth state after login — it persists across container runs
- Use `screenshot` for debugging: `agent-browser screenshot /tmp/debug.png`
- X may show CAPTCHAs or verification prompts — handle gracefully
