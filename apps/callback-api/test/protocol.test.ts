import { describe, expect, it } from "vitest"

import { ProtocolParseError, parseSuccessCallback } from "../src/lib/protocol"

const SESSION_ID = "session-123"

describe("Wedge enrichment result protocol", () => {
  it("parses a display-oriented result with fields and actions", () => {
    const parsed = parseSuccessCallback({
      session_id: SESSION_ID,
      status: "ok",
      result: {
        title: "Enrichment ready",
        summary: "Clay found the company domain and verified the role.",
        entity: {
          name: "Acme",
          domain: "acme.com",
          url: "https://acme.com",
          type: "company",
        },
        fields: [
          { label: "Company domain", value: "acme.com", type: "url" },
          { label: "Confidence", value: 0.92, type: "number", confidence: 0.92 },
        ],
        actions: [
          { type: "open_url", label: "Open Clay row", url: "https://app.clay.com/workspaces/row" },
          { type: "copy_value", label: "Copy domain", value: "acme.com" },
        ],
      },
      meta: {
        source: "clay",
        enriched_at: "2026-07-03T18:00:00.000Z",
      },
    })

    expect(parsed.result.title).toBe("Enrichment ready")
    expect(parsed.result.actions?.[0]?.type).toBe("open_url")
  })

  it("rejects unknown top-level keys and raw Clay row buckets", () => {
    expect(() =>
      parseSuccessCallback({
        session_id: SESSION_ID,
        status: "ok",
        result: { title: "Ready" },
        raw_row: { email: "alice@example.com" },
      })
    ).toThrow(ProtocolParseError)
  })

  it("rejects non-HTTPS action URLs", () => {
    expect(() =>
      parseSuccessCallback({
        session_id: SESSION_ID,
        status: "ok",
        result: {
          title: "Ready",
          actions: [{ type: "open_url", label: "Open", url: "http://app.clay.com/row" }],
        },
      })
    ).toThrow(ProtocolParseError)
  })

  it("rejects oversized field arrays", () => {
    expect(() =>
      parseSuccessCallback({
        session_id: SESSION_ID,
        status: "ok",
        result: {
          title: "Ready",
          fields: Array.from({ length: 21 }, (_, index) => ({
            label: `Field ${index}`,
            value: "value",
          })),
        },
      })
    ).toThrow(ProtocolParseError)
  })
})
