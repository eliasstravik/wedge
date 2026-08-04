# Contributing to Wedge

Thanks for your interest in contributing! This guide will help you get set up and make your first PR.

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- npm (included with Node.js)
- Google Chrome or Chromium

## Development setup

```bash
git clone https://github.com/eliasstravik/wedge.git
cd wedge
npm install
npm run dev
```

Then load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder from this repo

The Vite dev server supports hot reload — most changes will reflect immediately without reloading the extension.

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with hot reload |
| `npm run build` | Type-check and build for production |
| `npm run typecheck` | Run TypeScript type checking only |
| `npm test` | Build and run Playwright E2E tests |

## Running tests

Tests use Playwright and require Chromium. On first run:

```bash
npx playwright install chromium
npm test
```

## Project structure

```
src/
  popup/          # Popup UI (React)
  options/        # Settings/options page (React)
  background.ts   # Service worker (webhook delivery)
  contentScript.ts # Page metadata extraction
  lib/            # Shared types, storage, validation, utilities
  components/     # Reusable UI components (shadcn/ui)
  assets/         # Icons and brand images
tests/            # Playwright E2E tests
docs/             # Architecture and planning docs
```

## Making changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run typecheck` to catch type errors
4. Run `npm test` to verify E2E tests pass
5. Open a pull request against `main`

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Make sure all checks pass (typecheck, build, tests)
- Update documentation if your change affects user-facing behavior

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for reporting instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
