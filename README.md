<p align="center">
  <img src="src/assets/brand.png" width="80" alt="Wedge logo" />
</p>

<h1 align="center">Wedge</h1>

<p align="center">
  Chrome extension for sending data to Clay.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/eliasstravik/wedge/actions/workflows/ci.yml"><img src="https://github.com/eliasstravik/wedge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

---

## Install

### Quick install (no build required)

1. Download `wedge-vX.Y.Z.zip` from the [latest release](https://github.com/eliasstravik/wedge/releases/latest)
2. Unzip the file
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the unzipped folder

### Build from source

```bash
git clone https://github.com/eliasstravik/wedge.git
cd wedge
npm install
npm run build
```

Then load `dist/` as an unpacked extension (steps 3-5 above).

## Features

- **Popup send flow** — select a webhook, fill in fields, preview the JSON payload, and send
- **Page autofill** — automatically captures URL, title, description, canonical URL, og:title, selected text, and hostname
- **Custom fields** — add text, number, email, phone, date, dropdown, multi-select, rating, matrix, ranking, and more
- **Hardcoded fields** — lock any custom field to a fixed value so the popup shows it as read-only and always sends the configured payload value
- **Multi-webhook support** — configure multiple Clay webhooks with independent payload schemas
- **Settings workspace** — full webhook CRUD, payload field editor, drag-and-drop ordering, and test sends
- **Import / export** — share webhook configurations as JSON across your team
- **Activity history** — local log of sent and failed deliveries with timestamps and error details
- **Secure by default** — HTTPS-only delivery, private IP blocking, optional auth tokens, minimal permissions

## Development

```bash
npm install
npm run dev
```

Load the `dist/` folder as an unpacked extension in Chrome. The Vite dev server supports hot reload.

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Type-check and production build |
| `npm run typecheck` | TypeScript type checking only |
| `npm test` | Build and run Playwright E2E tests |

## Architecture

Built with React 19, TypeScript, Tailwind CSS 4, and shadcn/ui. Uses Vite with the [CRX plugin](https://crxjs.dev/vite-plugin) for Chrome Extension Manifest V3 bundling.

```
src/
  popup/           Popup UI
  options/         Settings page
  background.ts    Service worker (webhook delivery)
  contentScript.ts Page metadata extraction
  lib/             Types, storage, validation, utilities
  components/      Reusable UI components
```

See [`docs/chrome-extension-clay-webhook-plan.md`](docs/chrome-extension-clay-webhook-plan.md) for the full architecture plan.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Security

See [SECURITY.md](SECURITY.md) for the security model and how to report vulnerabilities.

## License

[MIT](LICENSE)
