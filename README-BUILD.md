# Fast Tech WhatsApp Manager — Build Guide

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18 LTS or 20 LTS | https://nodejs.org |
| npm | bundled with Node | — |
| Windows 10/11 x64 | required for EXE build | — |

---

## Quick Start

```bat
:: 1 — Install dependencies
cd "FAST TECH WHATS APP MANAGER"
npm install

:: 2 — Run in development mode (DevTools enabled)
npm run dev

:: 3 — Build Windows EXE installer + portable
npm run build
```

Built files appear in the `dist\` folder:
- `dist\Fast Tech WhatsApp Manager Setup 1.0.0.exe`  → NSIS installer
- `dist\Fast Tech WhatsApp Manager 1.0.0.exe`         → Portable single EXE

---

## Icon Setup

The app expects `assets\icon.ico`.

**Option A — Generate automatically:**
```bat
npm run generate-icon
```
*(requires the canvas-icon script — see below)*

**Option B — Manual:**
1. Create a 256×256 PNG of the Fast Tech logo
2. Convert to ICO at https://convertico.com  (select 16/32/48/64/128/256)
3. Save as `assets\icon.ico`

---

## First-Run Setup

1. Launch the app
2. Go to **الإعدادات** (Settings)
3. Enter your **WhatsApp Business API** credentials:
   - Access Token (from Meta Developer Portal)
   - Phone Number ID
   - Business Account ID
4. (Optional) Enter AI keys:
   - Google Gemini API key
   - Anthropic Claude API key
5. Go to **الحسابات** → Add Account → Test Connection ✓

---

## WhatsApp Business Cloud API — Getting Credentials

1. Go to https://developers.facebook.com
2. Create a Meta App → Business type
3. Add **WhatsApp** product
4. Under WhatsApp → API Setup, copy:
   - **Temporary access token** (or generate permanent via System User)
   - **Phone Number ID**
   - **WhatsApp Business Account ID**
5. Set up a webhook URL for delivery status updates (optional)

---

## Project Structure

```
FAST TECH WHATS APP MANAGER/
├── package.json
├── assets/
│   └── icon.ico
├── src/
│   ├── main/
│   │   ├── index.js          ← Electron main process
│   │   ├── preload.js        ← Secure IPC bridge
│   │   ├── database.js       ← SQLite data layer
│   │   ├── whatsapp-api.js   ← WhatsApp Business Cloud API
│   │   ├── ai-service.js     ← Gemini + Claude AI
│   │   ├── scheduler.js      ← Cron-based scheduler
│   │   ├── excel-handler.js  ← Excel import/export
│   │   └── ipc-handlers.js   ← IPC channel registry
│   └── renderer/
│       └── index.html        ← UI (single-file app)
└── dist/                     ← Build output
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `better-sqlite3` build error | Run `npm rebuild better-sqlite3 --update-binary` |
| `electron-builder` fails | Ensure Node 18+; try `npm run build -- --publish never` |
| App won't start | Check `%APPDATA%\fast-tech-whatsapp-manager\logs\` |
| API test fails | Verify token is not expired; check Phone Number ID |

---

## Data Location

User data is stored in:
```
C:\Users\<user>\AppData\Roaming\fast-tech-whatsapp-manager\fasttech-data\ftwa.db
```

Use **Settings → Backup** to export, **Settings → Restore** to import.
