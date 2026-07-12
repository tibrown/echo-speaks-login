#!/usr/bin/env node
/**
 * Packages ../echo-speaks-server/login-server.js into standalone
 * executables for Windows, macOS (Intel + Apple Silicon), and Linux.
 *
 * This script deliberately lives OUTSIDE echo-speaks-server and never
 * writes to any file inside it - it only reads login-server.js and its
 * existing (already-installed) node_modules/package.json as build input.
 *
 * Usage: npm run build
 */
"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const ENTRY = path.join(__dirname, "..", "echo-speaks-server", "login-server.js");
const OUT_DIR = path.join(__dirname, "dist");
const TARGETS = ["node22-linux-x64", "node22-macos-x64", "node22-macos-arm64", "node22-win-x64"];

console.log("Building Echo Speaks Login Helper executables...");
console.log("Entry:", ENTRY);
console.log("Targets:", TARGETS.join(", "));

execFileSync(
    "npx",
    [
        "pkg",
        ENTRY,
        "-t",
        TARGETS.join(","),
        // V8 bytecode caches are tied to the exact V8 build, not just the CPU
        // architecture. Building on this host only generates valid bytecode
        // for this host's own OS/arch; other targets (e.g. Windows) either
        // fail bytecode generation outright (caught by --fallback-to-source)
        // or "succeed" but produce bytecode that is rejected at runtime on
        // the target platform. Skipping bytecode entirely avoids both.
        "--no-bytecode",
        "--public", // required alongside --public-packages so the top-level entry ships as plain source too
        "--public-packages",
        "*", // required by --no-bytecode: ship all sources as plain JS instead of (protected) bytecode
        "--fallback-to-source", // safety net for any file --no-bytecode doesn't cover
        "--output",
        path.join(OUT_DIR, "echo-speaks-login"),
    ],
    { stdio: "inherit" },
);

console.log("\nDone! Executables written to:", OUT_DIR);
console.log(`
  echo-speaks-login-linux-x64        (Linux)
  echo-speaks-login-macos-x64        (macOS Intel)
  echo-speaks-login-macos-arm64      (macOS Apple Silicon / M-series)
  echo-speaks-login-win-x64.exe      (Windows)

macOS note: these binaries are NOT code-signed (no Apple Developer
account used). Apple Silicon Macs refuse to run unsigned binaries at
all, and Intel Macs will show a Gatekeeper warning. End users need to
run one of these once, locally, before first launch:
  - Apple Silicon (required): codesign --force --deep --sign - ./echo-speaks-login-macos-arm64
  - Intel (optional, removes the warning): codesign --force --deep --sign - ./echo-speaks-login-macos-x64
  ...or right-click the file > Open, and click "Open" on the warning dialog.
See the README for full end-user instructions.
`);
