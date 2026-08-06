import type { Context } from "hono"

import type { AppBindings, RuntimeEnv } from "../types"

export function publicBaseUrl(c: Context<AppBindings>, env: RuntimeEnv) {
  if (env.WEDGE_CALLBACK_PUBLIC_URL) {
    return env.WEDGE_CALLBACK_PUBLIC_URL.replace(/\/+$/, "")
  }

  const forwardedHost = c.req.header("x-forwarded-host")
  const forwardedProto = c.req.header("x-forwarded-proto") ?? "https"
  const host = forwardedHost ?? c.req.header("host")
  if (host) {
    return `${forwardedProto}://${host}`
  }

  const requestUrl = new URL(c.req.url)
  return requestUrl.origin
}
