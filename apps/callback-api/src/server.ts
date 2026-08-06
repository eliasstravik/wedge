import { createApp } from "./index"
import { createRuntime } from "./runtime"

declare const Bun: {
  serve(input: { port: number; fetch: (request: Request) => Response | Promise<Response> }): unknown
}

const runtime = createRuntime()
const app = createApp(runtime)
const port = Number.parseInt(runtime.env.PORT ?? "8787", 10)

Bun.serve({
  port: Number.isFinite(port) ? port : 8787,
  fetch: app.fetch,
})

console.log(`Wedge callback API listening on ${Number.isFinite(port) ? port : 8787}`)
