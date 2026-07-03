import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { chromium, expect, test, type BrowserContext, type Page } from "playwright/test"

let context: BrowserContext
let extensionId: string
let userDataDir: string

test.beforeAll(async () => {
  const extensionPath = path.resolve("dist")
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-e2e-"))
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })

  let [sw] = context.serviceWorkers()
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 15000 })
  }
  extensionId = new URL(sw.url()).host
})

test.afterAll(async () => {
  await context.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

function extensionUrl(entry: string) {
  return `chrome-extension://${extensionId}/${entry}`
}

test("popup points first-run users to settings and passes basic accessibility checks", async () => {
  const page = await context.newPage()
  await page.goto(extensionUrl("src/popup/index.html"))

  await expect(page.getByText("Add your first webhook")).toBeVisible()
  await expect(page.getByRole("button", { name: "New webhook" })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? "")
  )

  expect(seriousViolations).toEqual([])
  await page.close()
})

test("settings uses a breadcrumb editor flow and auto-generates snake_case custom keys", async () => {
  const page = await context.newPage()
  await page.goto(extensionUrl("src/options/index.html"))

  await expect(page.getByText("Add your first webhook")).toBeVisible()
  await page.getByRole("button", { name: "New webhook" }).first().click()

  await expect(page.getByRole("link", { name: "Create webhook" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Create webhook" })).toBeVisible()

  await page.getByLabel("Name", { exact: true }).fill("Clay leads")
  await page.getByLabel("Webhook URL").fill("https://httpbin.org/post")
  await addShortTextField(page)

  await expect(page.getByLabel("JSON key").last()).toHaveValue("short_text_1")
  await page.getByLabel("Label").last().fill("Lead note")
  await page.getByRole("button", { name: "Add webhook" }).first().click()

  await expect(page.getByText("Webhook created")).toBeVisible()
  await expect(page.getByText("Clay leads", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Actions for Clay leads" }).click()
  await page.getByRole("menuitem", { name: "Edit" }).click()

  await expect(page.getByRole("link", { name: "Clay leads" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Edit webhook" })).toBeVisible()
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Clay leads")
  await page.close()
})

test("popup renders schema-driven fields, preview JSON, and add-new entry", async () => {
  const popupPage = await context.newPage()
  await popupPage.goto(extensionUrl("src/popup/index.html"))

  await expect(popupPage.getByRole("combobox", { name: "Webhook" })).toContainText("Clay leads")
  await expect(popupPage.getByLabel("Lead note")).toBeVisible()
  await expect(popupPage.getByRole("button", { name: "JSON preview" })).toBeVisible()

  await popupPage.getByRole("button", { name: "JSON preview" }).click()
  await expect(popupPage.locator("pre code")).toContainText('"short_text_1": ""')

  await expect(popupPage.getByRole("button", { name: "Manage webhooks" })).toBeVisible()
  await popupPage.close()
})

test("settings can import multiple webhook configs into the CRUD list", async () => {
  const page = await context.newPage()
  await page.goto(extensionUrl("src/options/index.html"))

  await page.getByRole("button", { name: "Import webhooks" }).click()
  await page
    .getByLabel("Import webhook JSON")
    .fill(
      JSON.stringify(
        {
          webhooks: [
            {
              id: "import-one",
              name: "Imported one",
              webhookUrl: "https://httpbin.org/post",
              authenticationToken: "",
              isDefault: false,
              fields: [
                {
                  id: "field-one",
                  type: "builtin",
                  builtinKey: "url",
                  key: "url",
                  label: "Page URL",
                  required: true,
                },
              ],
              createdAt: new Date("2026-03-07T08:00:00.000Z").toISOString(),
              updatedAt: new Date("2026-03-07T08:00:00.000Z").toISOString(),
            },
            {
              id: "import-two",
              name: "Imported two",
              webhookUrl: "https://httpbin.org/post",
              authenticationToken: "",
              isDefault: false,
              fields: [
                {
                  id: "field-two",
                  type: "short_text",
                  key: "note",
                  label: "Note",
                  required: false,
                  defaultValue: "",
                },
              ],
              createdAt: new Date("2026-03-07T08:00:00.000Z").toISOString(),
              updatedAt: new Date("2026-03-07T08:00:00.000Z").toISOString(),
            },
          ],
        },
        null,
        2
      )
    )

  await page.getByRole("button", { name: "Import", exact: true }).click()

  await expect(page.getByText("Webhooks imported")).toBeVisible()
  await expect(page.getByText("Imported one", { exact: true })).toBeVisible()
  await expect(page.getByText("Imported two", { exact: true })).toBeVisible()
  await page.close()
})

test("settings can create a callback-mode webhook with server-side destination config", async () => {
  const page = await context.newPage()
  await page.goto(extensionUrl("src/options/index.html"))

  await page.getByRole("button", { name: "New webhook" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Callback leads")
  await page.getByLabel("Delivery mode").click()
  await page.getByRole("option", { name: "Wedge callback API" }).click()
  await page.getByLabel("Callback API URL").fill("https://callback.example.com")
  await page.getByLabel("Destination ID").fill("lead-review")
  await page.getByRole("button", { name: "Add webhook" }).first().click()

  await expect(page.getByText("Webhook created")).toBeVisible()
  await expect(page.getByText("Callback leads", { exact: true })).toBeVisible()
  await expect(page.getByText("Callback", { exact: true })).toBeVisible()
  await expect(page.getByText("https://callback.example.com · lead-review")).toBeVisible()
  await page.close()
})

test("popup renders callback results and clears local sessions", async () => {
  const page = await context.newPage()
  await page.goto(extensionUrl("src/popup/index.html"))

  const now = new Date("2026-07-03T18:00:00.000Z").toISOString()
  await page.evaluate((timestamp) => {
    return chrome.storage.local.set({
      "wedge.webhooks": [
        {
          id: "callback-webhook",
          name: "Callback leads",
          deliveryMode: "callback",
          webhookUrl: "",
          authenticationToken: "",
          callbackBaseUrl: "https://callback.example.com",
          callbackDestinationId: "lead-review",
          isDefault: true,
          fields: [
            {
              id: "field-url",
              type: "builtin",
              builtinKey: "url",
              key: "url",
              label: "Page URL",
              required: true,
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
          lastTestStatus: "idle",
        },
      ],
      "wedge.callbackSessions": [
        {
          sessionId: "session-ready",
          readToken: "read-token",
          expiresAt: 1780000600,
          webhookId: "callback-webhook",
          webhookName: "Callback leads",
          callbackBaseUrl: "https://callback.example.com",
          destinationId: "lead-review",
          requestId: "request-ready",
          status: "ready",
          result: {
            title: "Enrichment ready",
            summary: "Verified company data.",
            fields: [{ label: "Company", value: "Acme" }],
            actions: [{ type: "copy_value", label: "Copy company", value: "Acme" }],
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      "wedge.history": [],
      "wedge.uiState": { lastSelectedWebhookId: "callback-webhook" },
      "wedge.profile": [],
      "wedge.schemaVersion": 6,
    })
  }, now)

  await page.reload()

  await expect(page.getByText("Enrichment ready")).toBeVisible()
  await expect(page.getByText("Verified company data.")).toBeVisible()
  await expect(page.getByText("Company", { exact: true })).toBeVisible()
  await expect(page.getByText("Acme")).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy company" })).toBeVisible()

  await page.getByRole("button", { name: "Clear result" }).click()
  await expect(page.getByText("This browser is ready for another send.")).toBeVisible()
  await page.close()
})

async function addShortTextField(page: Page) {
  await page.getByRole("button", { name: "Add field" }).click()
  await page.getByRole("menuitem", { name: "Text", exact: true }).click()
}
