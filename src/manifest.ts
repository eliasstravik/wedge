import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Wedge",
  description: "Chrome extension for sending data to Clay.",
  version: "1.0.5",
  permissions: ["storage", "activeTab"],
  host_permissions: ["https://*/*"],
  icons: {
    16: "src/assets/icon-16.png",
    32: "src/assets/icon-32.png",
    48: "src/assets/icon-48.png",
    128: "src/assets/icon-128.png"
  },
  action: {
    default_title: "Wedge",
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "src/assets/icon-16.png",
      32: "src/assets/icon-32.png"
    }
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background.ts",
    type: "module"
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'"
  },
  content_scripts: [
    {
      matches: ["https://*/*"],
      js: ["src/contentScript.ts"],
      run_at: "document_idle"
    }
  ]
});
