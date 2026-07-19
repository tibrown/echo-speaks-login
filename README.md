# Echo Speaks Login Helper — Standalone Binary Builder

This repo builds standalone, double-click-to-run executables of the
Amazon login helper for Windows, macOS, and Linux.

## Agent runbook (repeatable build steps)

The current standalone project lives in:

`build-workspace/`

Build from there:

```bash
cd build-workspace
npm ci
npm run build
```

Built files are written to:

`build-workspace/dist/`

| File | Platform |
|---|---|
| `echo-speaks-login-win-x64.exe` | Windows 10/11 (64-bit) |
| `echo-speaks-login-macos-x64` | macOS, Intel |
| `echo-speaks-login-macos-arm64` | macOS, Apple Silicon |
| `echo-speaks-login-linux-x64` | Linux (64-bit) |

### Verification step (required)

After a build, verify at least one binary starts:

```bash
cd build-workspace
timeout 4 ./dist/echo-speaks-login-linux-x64
```

Expected behavior: it prints a local URL (`Echo Speaks Login Helper listening on ...`) and starts the helper server.

### Known/expected build warning

- `Unable to sign the macOS executable` is expected when building on Linux.
  macOS users can ad-hoc sign locally:
  - `codesign --force --deep --sign - ./echo-speaks-login-macos-arm64`
  - `codesign --force --deep --sign - ./echo-speaks-login-macos-x64`

### Important packaging flags used

`build-workspace/build.js` intentionally uses:

- `--no-bytecode`
- `--public`
- `--public-packages "*"`

This avoids cross-platform V8 bytecode cache mismatches (especially Windows target failures when built from Linux).
