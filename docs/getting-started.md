# Getting started — capture your first prospect

This guide takes you from a downloaded Wedge extension to a prospect entering Clay for enrichment and routing, in about five minutes.

## 1. Prepare a Clay webhook

1. In Clay, create or open a table.
2. Add **Pull in data from a Webhook** as a source.
3. Copy the webhook URL.
4. If the Clay table uses an authentication token, copy that too.

## 2. Install Wedge

1. Download `wedge-vX.Y.Z.zip` from the [latest Wedge release](https://github.com/eliasstravik/wedge/releases/latest).
2. Unzip the downloaded file.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the unzipped Wedge folder.
6. Pin Wedge from Chrome's extensions menu so it stays within reach while you prospect.

### Build from source instead

```bash
git clone https://github.com/eliasstravik/wedge.git
cd wedge
npm install
npm run build
```

Then follow steps 3–6 above and select the generated `dist/` folder when Chrome asks which folder to load.

## 3. Connect your Clay workflow

1. Click the Wedge extension icon.
2. Click **New webhook**.
3. Give the workflow a clear name, such as `Accounts`, `Contacts`, or `Buying signals`.
4. Paste the Clay webhook URL and, if needed, its authentication token.
5. Keep the page fields you want Wedge to capture automatically, then add any custom, fixed, or rep profile fields your workflow needs.
6. Click **Add webhook**.

You can save more than one workflow and choose a default for the prospecting motion you use most often.

## 4. Capture your first prospect

1. Open the company, contact, or buying-signal page you want to capture. Wedge works on HTTPS pages.
2. Select any useful passage you want to carry into Clay.
3. Open Wedge and choose the right workflow.
4. Check the captured page context and add any important notes.
5. Click **Send webhook**.

Wedge sends the prospect directly to Clay. From there, your Clay workflow can enrich the record and route it into the CRM list or outbound campaign you configured.

## 5. Confirm the handoff

Open the destination table in Clay and confirm that the new record arrived. Wedge also keeps a local activity history with successful sends and actionable errors.

## Share the setup with your team

Open Wedge's settings and export one webhook or all of them. Authentication tokens are excluded unless you explicitly include them. A teammate can import the file into their own Chrome profile, add their rep profile fields, and start with the same capture forms and destinations.

## Update Wedge

Download and unzip the [latest release](https://github.com/eliasstravik/wedge/releases/latest), replace the previously loaded folder, then click the refresh button for Wedge on `chrome://extensions`.

## Troubleshooting

- **Wedge does not appear in the toolbar:** Open Chrome's extensions menu and pin it.
- **The page context is empty:** Refresh the HTTPS page after installing Wedge, then open the extension again.
- **Clay does not receive the prospect:** Check the webhook URL and optional authentication token, then review Wedge's local activity history for the returned error.
- **Chrome reports an extension error:** Open `chrome://extensions`, remove the older Wedge entry, and load the unzipped release folder again.

For more help, read the [troubleshooting guide](../TROUBLESHOOTING.md) or [open an issue](https://github.com/eliasstravik/wedge/issues).
