# Headless/API Channel Protocol

The headless channel exposes a simple HTTP API for programmatic access to mdclaw. It enables integration with external systems, webhooks, scripts, and custom UIs without requiring a messaging platform.

## Endpoints

### POST /message

Send a message to the assistant.

**Request:**
```json
{
  "content": "Hello, what's the weather?",
  "sender_name": "API User",
  "channel_id": "default"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `content` | string | yes | — | Message text |
| `sender_name` | string | no | `"api"` | Display name of the sender |
| `channel_id` | string | no | `"default"` | Logical channel for message routing |

**Response (202 Accepted):**
```json
{
  "status": "queued",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Errors:**
- `401 Unauthorized` — missing or invalid Bearer token
- `400 Bad Request` — missing `content` field
- `413 Payload Too Large` — content exceeds 10,000 characters

### GET /groups

List all registered groups.

**Response (200 OK):**
```json
{
  "groups": [
    {
      "name": "Main",
      "folder": "main",
      "trigger": "@Andy",
      "jids": ["hl:default"]
    }
  ]
}
```

### GET /health

Health check endpoint. No authentication required.

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

## Authentication

All endpoints except `/health` require a Bearer token:

```
Authorization: Bearer <HEADLESS_SECRET>
```

The secret is configured via the `HEADLESS_SECRET` environment variable. If `HEADLESS_SECRET` is not set, all endpoints are accessible without authentication (useful for local development).

## JID Format

Headless JIDs use the format `hl:{channel_id}`:
- Default: `hl:default`
- Custom: `hl:webhook-1`, `hl:api-frontend`, etc.

## Response Delivery

The headless channel is fire-and-forward. Responses from the assistant are stored in an in-memory ring buffer (capacity: 100 per JID). External clients can:

1. Poll via a future `GET /responses/{request_id}` endpoint (not yet implemented)
2. Configure a webhook URL for push delivery (not yet implemented)
3. Use the headless channel as a one-way input mechanism, with responses delivered via another channel (e.g., Discord, Slack)

## Rate Limits

No built-in rate limiting — expected to run behind a reverse proxy or API gateway in production.
