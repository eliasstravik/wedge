export type CorsEndpoint = "submit" | "session"

export function checkOrigin(origin: string | undefined | null, allowedOrigins: readonly string[]) {
  if (!origin) {
    return null
  }

  return allowedOrigins.includes(origin) ? origin : null
}

export function checkOriginOrReferer(
  origin: string | undefined | null,
  referer: string | undefined | null,
  allowedOrigins: readonly string[]
) {
  const originMatch = checkOrigin(origin, allowedOrigins)
  if (originMatch) {
    return originMatch
  }

  if (!referer) {
    return null
  }

  try {
    const refererOrigin = new URL(referer).origin
    return allowedOrigins.includes(refererOrigin) ? refererOrigin : null
  } catch {
    return null
  }
}

export function corsHeadersFor(origin: string, endpoint: CorsEndpoint) {
  const methods = endpoint === "submit" ? "POST, OPTIONS" : "GET, OPTIONS"
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}
