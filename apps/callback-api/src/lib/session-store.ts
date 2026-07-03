import Redis from "ioredis"

export type SessionStatus = "pending" | "ready" | "failed" | "expired"

export type SessionRecord = {
  session_id: string
  status: SessionStatus
  read_token_hash: string
  origin: string
  created_at_unix: number
  expires_at_unix: number
  destination_id: string
  result_hash?: string
  result_payload?: unknown
  error_code?: string
  duration_ms?: number
}

export type WritePendingParams = {
  sessionId: string
  readTokenHash: string
  origin: string
  expiresAtUnix: number
  ttlSeconds: number
  destinationId: string
}

export type TransitionToTerminalParams =
  | {
      sessionId: string
      status: "ready"
      resultHash: string
      resultPayload: unknown
    }
  | {
      sessionId: string
      status: "failed" | "expired"
      errorCode?: string
    }

export type TransitionResult =
  | { kind: "transitioned"; previousStatus: "pending" }
  | { kind: "idempotent_duplicate"; resultHash: string }
  | { kind: "conflict"; previousResultHash: string }
  | { kind: "not_found" }
  | { kind: "not_pending"; currentStatus: "ready" | "failed" | "expired" }

export type SessionLogEntry = {
  session_id: string
  status: SessionStatus
  created_at_unix: number
  duration_ms?: number
  destination_id: string
  origin: string
  error_code?: string
}

export interface SessionStore {
  readonly kind: "memory" | "redis"
  read(sessionId: string): Promise<SessionRecord | null>
  writePending(params: WritePendingParams): Promise<void>
  transitionToTerminal(params: TransitionToTerminalParams): Promise<TransitionResult>
  listRecent(limit: number): Promise<SessionLogEntry[]>
  close?(): Promise<void>
}

type TimedRecord = {
  value: SessionRecord
  deleteAfterMs: number
}

const RECORD_RETENTION_SECONDS = 604_800

export class MemorySessionStore implements SessionStore {
  readonly kind = "memory" as const
  private readonly records = new Map<string, TimedRecord>()

  async read(sessionId: string): Promise<SessionRecord | null> {
    this.prune()
    const entry = this.records.get(sessionId)
    if (!entry) {
      return null
    }

    const record = expireIfNeeded(entry.value)
    if (record !== entry.value) {
      entry.value = record
    }
    return clone(record)
  }

  async writePending(params: WritePendingParams): Promise<void> {
    this.prune()
    if (params.ttlSeconds <= 0) {
      throw new Error("ttlSeconds must be positive")
    }
    if (this.records.has(params.sessionId)) {
      throw new Error(`Session ${params.sessionId} already exists`)
    }

    const nowUnix = nowSeconds()
    this.records.set(params.sessionId, {
      value: {
        session_id: params.sessionId,
        status: "pending",
        read_token_hash: params.readTokenHash,
        origin: params.origin,
        created_at_unix: nowUnix,
        expires_at_unix: params.expiresAtUnix,
        destination_id: params.destinationId,
      },
      deleteAfterMs: Date.now() + (params.ttlSeconds + RECORD_RETENTION_SECONDS) * 1000,
    })
  }

  async transitionToTerminal(params: TransitionToTerminalParams): Promise<TransitionResult> {
    this.prune()
    const entry = this.records.get(params.sessionId)
    if (!entry) {
      return { kind: "not_found" }
    }

    const live = expireIfNeeded(entry.value)
    entry.value = live

    if (live.status !== "pending") {
      if (params.status === "ready" && live.status === "ready") {
        if (live.result_hash === params.resultHash) {
          return { kind: "idempotent_duplicate", resultHash: params.resultHash }
        }
        return { kind: "conflict", previousResultHash: live.result_hash ?? "" }
      }
      return { kind: "not_pending", currentStatus: live.status }
    }

    entry.value = toTerminalRecord(live, params)
    return { kind: "transitioned", previousStatus: "pending" }
  }

  async listRecent(limit: number): Promise<SessionLogEntry[]> {
    this.prune()
    return [...this.records.values()]
      .map((entry) => redactLogEntry(expireIfNeeded(entry.value)))
      .sort((left, right) => right.created_at_unix - left.created_at_unix)
      .slice(0, limit)
  }

  private prune() {
    const now = Date.now()
    for (const [sessionId, entry] of this.records.entries()) {
      if (entry.deleteAfterMs <= now) {
        this.records.delete(sessionId)
      }
    }
  }
}

export class RedisSessionStore implements SessionStore {
  readonly kind = "redis" as const
  private readonly redis: Redis
  private readonly prefix: string

  constructor(redisUrl: string, prefix = "wedge:callback") {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    })
    this.prefix = prefix
  }

  async read(sessionId: string): Promise<SessionRecord | null> {
    const record = await this.readRaw(sessionId)
    if (!record) {
      return null
    }

    const live = expireIfNeeded(record)
    if (live !== record) {
      await this.writeRaw(live, retentionSecondsFor(live))
    }
    return live
  }

  async writePending(params: WritePendingParams): Promise<void> {
    if (params.ttlSeconds <= 0) {
      throw new Error("ttlSeconds must be positive")
    }

    const nowUnix = nowSeconds()
    const record: SessionRecord = {
      session_id: params.sessionId,
      status: "pending",
      read_token_hash: params.readTokenHash,
      origin: params.origin,
      created_at_unix: nowUnix,
      expires_at_unix: params.expiresAtUnix,
      destination_id: params.destinationId,
    }
    const result = await this.redis.set(
      this.key(params.sessionId),
      JSON.stringify(record),
      "EX",
      params.ttlSeconds + RECORD_RETENTION_SECONDS,
      "NX"
    )
    if (result !== "OK") {
      throw new Error(`Session ${params.sessionId} already exists`)
    }
  }

  async transitionToTerminal(params: TransitionToTerminalParams): Promise<TransitionResult> {
    const key = this.key(params.sessionId)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.redis.watch(key)
      const raw = await this.redis.get(key)
      const record = raw ? parseRecord(raw) : null

      if (!record) {
        await this.redis.unwatch()
        return { kind: "not_found" }
      }

      const live = expireIfNeeded(record)
      if (live.status !== "pending") {
        if (live !== record) {
          const updated = await this.redis
            .multi()
            .set(key, JSON.stringify(live), "EX", retentionSecondsFor(live))
            .exec()
          if (updated === null) {
            continue
          }
        } else {
          await this.redis.unwatch()
        }

        if (params.status === "ready" && live.status === "ready") {
          if (live.result_hash === params.resultHash) {
            return { kind: "idempotent_duplicate", resultHash: params.resultHash }
          }
          return { kind: "conflict", previousResultHash: live.result_hash ?? "" }
        }
        return { kind: "not_pending", currentStatus: live.status }
      }

      const next = toTerminalRecord(live, params)
      const updated = await this.redis
        .multi()
        .set(key, JSON.stringify(next), "EX", retentionSecondsFor(next))
        .exec()
      if (updated !== null) {
        return { kind: "transitioned", previousStatus: "pending" }
      }
    }

    const latest = await this.readRaw(params.sessionId)
    if (!latest) {
      return { kind: "not_found" }
    }
    const live = expireIfNeeded(latest)
    if (params.status === "ready" && live.status === "ready") {
      if (live.result_hash === params.resultHash) {
        return { kind: "idempotent_duplicate", resultHash: params.resultHash }
      }
      return { kind: "conflict", previousResultHash: live.result_hash ?? "" }
    }
    if (live.status === "pending") {
      throw new Error("Redis session transition failed after repeated contention")
    }
    return { kind: "not_pending", currentStatus: live.status }
  }

  async listRecent(limit: number): Promise<SessionLogEntry[]> {
    const keys = await this.redis.keys(`${this.prefix}:session:*`)
    const values = await Promise.all(keys.map((key) => this.redis.get(key)))
    return values
      .map((value) => (value ? parseRecord(value) : null))
      .filter((record): record is SessionRecord => record !== null)
      .map((record) => redactLogEntry(expireIfNeeded(record)))
      .sort((left, right) => right.created_at_unix - left.created_at_unix)
      .slice(0, limit)
  }

  async close() {
    this.redis.disconnect()
  }

  private async readRaw(sessionId: string) {
    const value = await this.redis.get(this.key(sessionId))
    return value ? parseRecord(value) : null
  }

  private async writeRaw(record: SessionRecord, ttlSeconds: number) {
    await this.redis.set(this.key(record.session_id), JSON.stringify(record), "EX", ttlSeconds)
  }

  private key(sessionId: string) {
    return `${this.prefix}:session:${sessionId}`
  }
}

export function createSessionStore(input: { redisUrl?: string }): SessionStore {
  return input.redisUrl ? new RedisSessionStore(input.redisUrl) : new MemorySessionStore()
}

function toTerminalRecord(record: SessionRecord, params: TransitionToTerminalParams): SessionRecord {
  const durationMs = Math.max(0, (nowSeconds() - record.created_at_unix) * 1000)
  if (params.status === "ready") {
    return {
      ...record,
      status: "ready",
      result_hash: params.resultHash,
      result_payload: params.resultPayload,
      duration_ms: durationMs,
    }
  }

  return {
    ...record,
    status: params.status,
    error_code: params.errorCode,
    duration_ms: durationMs,
  }
}

function expireIfNeeded(record: SessionRecord): SessionRecord {
  if (record.status !== "pending" || record.expires_at_unix >= nowSeconds()) {
    return record
  }

  return toTerminalRecord(record, { sessionId: record.session_id, status: "expired" })
}

function redactLogEntry(record: SessionRecord): SessionLogEntry {
  return {
    session_id: record.session_id,
    status: record.status,
    created_at_unix: record.created_at_unix,
    duration_ms: record.duration_ms,
    destination_id: record.destination_id,
    origin: record.origin,
    error_code: record.error_code,
  }
}

function retentionSecondsFor(record: SessionRecord) {
  return Math.max(60, record.expires_at_unix - nowSeconds() + RECORD_RETENTION_SECONDS)
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseRecord(value: string): SessionRecord | null {
  try {
    const parsed = JSON.parse(value) as SessionRecord
    if (!parsed || typeof parsed.session_id !== "string") {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
