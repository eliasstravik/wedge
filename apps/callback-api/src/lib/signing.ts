import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto"

export type SignedCallback = {
  sig: string
  expiresAt: number
  nonce: string
  kid: string
}

export function generateNonce() {
  return randomBytes(16).toString("hex")
}

export function signCallback(input: {
  sessionId: string
  expiresAt: number
  nonce: string
  kid: string
  signingKey: string
}): SignedCallback {
  return {
    sig: hmac(input.signingKey, signingPayload(input)),
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    kid: input.kid,
  }
}

export function verifyCallback(input: {
  sessionId: string
  sig: string
  expiresAt: number
  nonce: string
  kid: string
  primaryKey: string
  previousKey?: string
}): { valid: true } | { valid: false; reason: "expired" | "unknown_kid" | "invalid_signature" } {
  if (input.expiresAt < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" }
  }

  const key =
    input.kid === "primary"
      ? input.primaryKey
      : input.kid === "previous"
        ? input.previousKey
        : undefined

  if (!key) {
    return { valid: false, reason: "unknown_kid" }
  }

  const expected = hmac(key, signingPayload(input))
  if (!timingSafeEqualText(expected, input.sig)) {
    return { valid: false, reason: "invalid_signature" }
  }

  return { valid: true }
}

export function timingSafeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false
  }

  return nodeTimingSafeEqual(leftBuffer, rightBuffer)
}

function signingPayload(input: { sessionId: string; expiresAt: number; nonce: string; kid: string }) {
  return `${input.sessionId}.${input.expiresAt}.${input.nonce}.${input.kid}`
}

function hmac(key: string, payload: string) {
  return createHmac("sha256", key).update(payload).digest("base64url")
}
