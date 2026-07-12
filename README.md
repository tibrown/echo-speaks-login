# Echo Speaks Login Helper — Builder

This folder builds standalone, double-click-to-run executables of the
Amazon login helper (`../echo-speaks-server/login-server.js`) for
Windows, macOS, and Linux — **no Node.js or npm required by end users.**

It is a completely separate project from `echo-speaks-server` and never
modifies any file inside it (only reads `login-server.js` and the
already-installed `node_modules`/`package.json` there as build input).

## For developers: building the executables

```bash
npm install     # once, installs @yao-pkg/pkg
npm run build   # produces dist/echo-speaks-login-<platform>
```

Outputs in `dist/`:
| File | Platform |
|---|---|
| `echo-speaks-login-win-x64.exe` | Windows 10/11 (64-bit) |
| `echo-speaks-login-macos-x64` | macOS, Intel |
| `echo-speaks-login-macos-arm64` | macOS, Apple Silicon (M1/M2/M3/M4) |
| `echo-speaks-login-linux-x64` | Linux (64-bit) |

Each one is a single file (~70-90MB) with a full Node.js runtime baked
in. Nothing else needs to be installed to run them.

## For end users (no technical background required)

1. Download the one file that matches your computer (see table above)
   from wherever it was shared with you.
2. **First launch only** — your OS may show a security warning because
   this file isn't signed by a paid developer certificate. This is
   normal for small independent tools. To proceed:
   - **Windows:** Click "More info" → "Run anyway" on the SmartScreen
     popup.
   - **macOS:** Right-click (or Control-click) the file → "Open" → click
     "Open" again on the dialog that appears. If macOS still refuses
     ("cannot be opened because the developer cannot be verified" with
     no Open option, common on Apple Silicon Macs), open the Terminal
     app, drag the downloaded file into the Terminal window after typing
     `xattr -d com.apple.quarantine ` (with the trailing space), press
     Enter, then double-click the file normally.
   - **Linux:** Right-click → Properties → Permissions → "Allow
     executing file as program" (or run `chmod +x
     echo-speaks-login-linux-x64` in a terminal), then double-click or
     run it.
3. A browser window opens automatically. The very first time, paste in
   the **Cloud Endpoint URL** shown on the Echo Speaks app's config page
   in Hubitat, and pick your Amazon country/domain, then click **Save &
   Continue**. (This is saved for next time — you won't need to do this
   step again.)
4. Click **Login to Amazon** and sign in like you normally would
   (including any 2FA/one-time code Amazon asks for).
5. When it's done, the page will show "Sent to Hubitat successfully."
   Close the window and the little terminal/console window that opened
   alongside it — you're finished.

You'll only need to run this again in the rare case that Amazon fully
logs you out and revokes access (Echo Speaks normally keeps itself
logged in automatically after this one-time setup).
