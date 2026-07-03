# Wedge Callback API

Wedge supports direct-to-Clay webhooks by default. Callback mode adds a Wedge-owned backend in `apps/callback-api` so the extension can send once, poll a short-lived session, render Clay's enrichment result, and clear it locally.

## Flow

1. The extension sends callback-mode payloads to `POST /api/submit`:

```json
{
  "lead": {
    "url": "https://example.com",
    "title": "Example lead"
  },
  "destination_id": "default"
}
```

2. The callback API resolves `destination_id` from `WEDGE_CALLBACK_DESTINATIONS`, forwards to Clay, and includes a signed `callback_url`.
3. Clay's final HTTP step posts the strict result body to `callback_url`.
4. The extension polls `GET /api/session/:sessionId?wait=1` with `Authorization: Bearer <read_token>`.
5. Clearing a result is local browser dismissal; there is no server delete endpoint.

## Clay Final HTTP Body

Clay should post exactly this shape to the `callback_url` it receives. Unknown top-level keys are rejected, URLs must use HTTPS, and raw Clay row payloads should not be included.

```json
{
  "session_id": "{{session_id}}",
  "status": "ok",
  "result": {
    "title": "Enrichment ready",
    "summary": "Clay verified the company domain and found two useful next steps.",
    "entity": {
      "name": "Acme",
      "domain": "acme.com",
      "url": "https://acme.com",
      "type": "company"
    },
    "fields": [
      {
        "label": "Company domain",
        "value": "acme.com",
        "type": "url",
        "confidence": 0.95,
        "source_url": "https://acme.com"
      }
    ],
    "actions": [
      {
        "type": "open_url",
        "label": "Open Clay row",
        "url": "https://app.clay.com/workspaces/example/table/example/row/example"
      },
      {
        "type": "copy_value",
        "label": "Copy domain",
        "value": "acme.com"
      }
    ]
  },
  "meta": {
    "source": "clay",
    "enriched_at": "2026-07-03T18:00:00.000Z"
  }
}
```

Failure callbacks use:

```json
{
  "session_id": "{{session_id}}",
  "status": "error",
  "error_code": "CLAY_ENRICHMENT_FAILED",
  "message": "Optional display-safe detail"
}
```

## Railway Environment

Required for production:

- `WEDGE_CALLBACK_SIGNING_KEY`: stable secret for signed callback URLs.
- `WEDGE_CALLBACK_READ_KEY`: stable secret for per-session read-token hashes.
- `WEDGE_CALLBACK_ALLOWED_ORIGINS`: exact browser origins, for example `chrome-extension://<extension-id>`.
- `WEDGE_CALLBACK_DESTINATIONS`: JSON map of server-side Clay destinations.
- `REDIS_URL`: Railway Redis URL for persistent session storage.

Recommended:

- `WEDGE_CALLBACK_PUBLIC_URL`: public callback API origin if Railway forwarding headers are not enough.
- `WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE=true`: readiness fails unless Redis is active.

Example destinations:

```json
{
  "default": {
    "webhook_url": "https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook/default",
    "auth_token": "clay-secret"
  },
  "lead-review": {
    "webhook_url": "https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook/lead-review",
    "headers": {
      "x-clay-workspace": "sales"
    }
  }
}
```

The extension never sends Clay webhook URLs or Clay auth tokens in callback mode.
