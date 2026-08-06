import { beforeEach, describe, expect, it, vi } from "vitest"

import { MemorySessionStore } from "../src/lib/session-store"

const NOW_UNIX = 1_780_000_000
const SESSION_ID = "session-123"
const READ_TOKEN_HASH = "a".repeat(64)
const ORIGIN = "chrome-extension://extension-id"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_UNIX * 1000)
})

describe("MemorySessionStore", () => {
  it("round-trips a pending session", async () => {
    const store = new MemorySessionStore()
    await writePending(store)

    await expect(store.read(SESSION_ID)).resolves.toMatchObject({
      session_id: SESSION_ID,
      status: "pending",
      read_token_hash: READ_TOKEN_HASH,
      origin: ORIGIN,
      destination_id: "default",
      expires_at_unix: NOW_UNIX + 600,
    })
  })

  it("marks pending sessions expired after TTL while preserving the read token boundary", async () => {
    const store = new MemorySessionStore()
    await writePending(store)

    vi.setSystemTime((NOW_UNIX + 601) * 1000)

    await expect(store.read(SESSION_ID)).resolves.toMatchObject({
      session_id: SESSION_ID,
      status: "expired",
      read_token_hash: READ_TOKEN_HASH,
    })
  })

  it("treats identical ready callbacks as idempotent duplicates and rejects divergent callbacks", async () => {
    const store = new MemorySessionStore()
    await writePending(store)

    await expect(
      store.transitionToTerminal({
        sessionId: SESSION_ID,
        status: "ready",
        resultHash: "hash-1",
        resultPayload: { title: "Ready" },
      })
    ).resolves.toEqual({ kind: "transitioned", previousStatus: "pending" })

    await expect(
      store.transitionToTerminal({
        sessionId: SESSION_ID,
        status: "ready",
        resultHash: "hash-1",
        resultPayload: { title: "Ready" },
      })
    ).resolves.toEqual({ kind: "idempotent_duplicate", resultHash: "hash-1" })

    await expect(
      store.transitionToTerminal({
        sessionId: SESSION_ID,
        status: "ready",
        resultHash: "hash-2",
        resultPayload: { title: "Different" },
      })
    ).resolves.toEqual({ kind: "conflict", previousResultHash: "hash-1" })
  })
})

async function writePending(store: MemorySessionStore) {
  await store.writePending({
    sessionId: SESSION_ID,
    readTokenHash: READ_TOKEN_HASH,
    origin: ORIGIN,
    expiresAtUnix: NOW_UNIX + 600,
    ttlSeconds: 600,
    destinationId: "default",
  })
}
