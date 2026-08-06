import { createHmac, randomBytes } from "node:crypto"

export function mintReadToken() {
  return `wcr_${base64Url(randomBytes(32))}`
}

export function hashReadToken(readToken: string, readKey: string) {
  return createHmac("sha256", readKey).update(readToken).digest("hex")
}

function base64Url(bytes: Buffer) {
  return bytes
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}
