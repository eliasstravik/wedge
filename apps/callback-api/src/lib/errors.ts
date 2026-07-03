export const ERR_CALLBACK_CONFLICT = "CALLBACK_CONFLICT"
export const ERR_CONTENT_TYPE_INVALID = "CONTENT_TYPE_INVALID"
export const ERR_DESTINATION_NOT_FOUND = "DESTINATION_NOT_FOUND"
export const ERR_INVALID_AUTH = "INVALID_AUTH"
export const ERR_INVALID_CALLBACK_PAYLOAD = "INVALID_CALLBACK_PAYLOAD"
export const ERR_INVALID_SUBMIT_SHAPE = "INVALID_SUBMIT_SHAPE"
export const ERR_MISSING_AUTH = "MISSING_AUTH"
export const ERR_MISSING_SIG_PARAMS = "MISSING_SIG_PARAMS"
export const ERR_ORIGIN_NOT_ALLOWED = "ORIGIN_NOT_ALLOWED"
export const ERR_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
export const ERR_RATE_LIMITED = "RATE_LIMITED"
export const ERR_SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
export const ERR_SESSION_NOT_PENDING = "SESSION_NOT_PENDING"
export const ERR_SIGNATURE_EXPIRED = "SIGNATURE_EXPIRED"
export const ERR_SIGNATURE_INVALID = "SIGNATURE_INVALID"
export const ERR_UNKNOWN_KID = "UNKNOWN_KID"

export type ApiErrorBody = {
  error: string
  problem: string
  cause?: string
  fix?: string
}

export function errorResponse(status: number, body: ApiErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  })
}

export function withHeaders(response: Response, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}
