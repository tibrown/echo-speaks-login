/**
 * Echo Speaks - Minimal Amazon Login Helper
 * ------------------------------------------
 * A tiny, single-purpose Node script that serves ONE web page to log
 * into Amazon and forwards the resulting cookie/token data straight to
 * the Echo Speaks app's Hubitat cloud endpoint.
 *
 * This is intentionally kept as a standalone file that does not modify
 * any of the existing echo-speaks-server code (index.js, package.json,
 * README.md, etc.) - it only reuses the existing libs/alexa-cookie
 * dependency already vendored in this repo.
 *
 * Unlike the full echo-speaks-server (index.js), this script does NOT:
 *   - poll or schedule periodic cookie refreshes
 *   - support Alexa Guard status polling
 *   - support a /wakeup endpoint
 *   - support scripted username/password login
 * None of that is needed anymore: the Echo Speaks Hubitat app now
 * refreshes its own Alexa cookie directly (see directCookieRefresh() in
 * apps/echo-speaks.groovy) using the refreshToken captured here. This
 * script only needs to run for the initial interactive login (or
 * whenever Amazon fully revokes the refresh token and a new login is
 * required) - it does not need to stay running afterward.
 *
 * Usage:
 *   node login-server.js
 *   open http://localhost:8092/   (opens automatically)
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const express = require("express");
const reqPromise = require("request-promise");
const findFreePort = require("find-free-port");
const alexaCookie = require("./libs/alexa-cookie/alexa-cookie");
const packageFile = require("./package.json");

const REQUESTED_PORT = parseInt(process.env.PORT || "8092", 10);
const CONFIG_PATH = process.env.LOGIN_CONFIG_PATH || path.join(os.homedir(), ".echo-speaks-login.json");
const AMAZON_DOMAINS = ["amazon.com", "amazon.ca", "amazon.co.uk", "amazon.com.au", "amazon.de", "amazon.it", "amazon.com.br", "amazon.com.mx"];
// Packaged executables (via @yao-pkg/pkg) run from a read-only virtual
// filesystem, so anything the alexa-cookie proxy wants to persist next to
// its own __dirname must be redirected somewhere real and writable instead.
const FORMER_DATA_STORE_PATH = path.join(os.tmpdir(), "echo-speaks-login-formerdata.json");

// Set once the HTTP server is actually listening (may differ from
// REQUESTED_PORT if that port was already taken - see listenWithFallback()).
let ACTUAL_PORT = REQUESTED_PORT;

let config = loadConfig();
// Tracks the outcome of the in-flight (or most recent) login attempt so the
// /cookie-success page can poll for a final result once Amazon redirects back.
let loginState = { status: "idle", message: "" };
let proxyStarted = false;

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch (_err) {
        return {};
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) return iface.address;
        }
    }
    return "127.0.0.1";
}

function htmlPage(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 560px; margin: 60px auto; padding: 0 20px; color: #222; }
  h1 { font-size: 1.4rem; }
  input[type=text], select { width: 100%; padding: 8px; margin: 8px 0 16px; box-sizing: border-box; font-size: 0.95rem; }
  button, a.button { display: inline-block; padding: 10px 20px; background: #d97b29; color: #fff; border: 0; border-radius: 4px; cursor: pointer; text-decoration: none; font-size: 0.95rem; }
  .ok { color: #2e7d32; }
  .err { color: #c62828; }
  .muted { color: #666; font-size: 0.85rem; }
  code { background: #f2f2f2; padding: 2px 5px; border-radius: 3px; }
</style>
</head>
<body>
<h1>Echo Speaks &mdash; Amazon Login</h1>
${bodyHtml}
</body>
</html>`;
}

const app = express();

app.get("/", (req, res) => {
    if (!config.appCallbackUrl) {
        res.send(
            htmlPage(
                "Echo Speaks Login - Setup",
                `<p>Paste the <strong>Cloud Endpoint URL</strong> shown on the Echo Speaks app's config page in Hubitat. This is only needed once.</p>
                <form method="POST" action="/setup">
                    <label for="appCallbackUrl">Hubitat Cloud Endpoint URL</label>
                    <input type="text" id="appCallbackUrl" name="appCallbackUrl" placeholder="https://cloud.hubitat.com/api/.../apps/.../receiveData?access_token=..." required>
                    <label for="amazonDomain">Amazon Domain</label>
                    <select id="amazonDomain" name="amazonDomain">
                        ${AMAZON_DOMAINS.map((d) => `<option value="${d}">${d}</option>`).join("")}
                    </select>
                    <button type="submit">Save &amp; Continue</button>
                </form>`,
            ),
        );
        return;
    }

    startProxyIfNeeded();
    res.send(
        htmlPage(
            "Echo Speaks Login",
            `<p>Endpoint: <code>${config.appCallbackUrl}</code> &middot; Domain: <code>${config.amazonDomain || "amazon.com"}</code></p>
            <p><a class="button" href="/proxy">Login to Amazon</a></p>
            <p class="muted">This opens the real Amazon sign-in page (2FA/OTP works normally). Once you finish, the token is captured automatically and sent to Hubitat.</p>
            <p class="muted"><a href="/reset">Change endpoint / domain</a></p>`,
        ),
    );
});

app.post("/setup", express.urlencoded({ extended: false }), express.json(), (req, res) => {
    const url = (req.body.appCallbackUrl || "").trim();
    if (!url) {
        res.status(400).send(htmlPage("Error", `<p class="err">A callback URL is required.</p><p><a href="/">Back</a></p>`));
        return;
    }
    if (!url.includes("/receiveData")) {
        res.status(400).send(
            htmlPage(
                "Error",
                `<p class="err">That doesn't look like the Echo Speaks "receiveData" cloud endpoint URL. Copy it from the app's config page in Hubitat.</p><p><a href="/">Back</a></p>`,
            ),
        );
        return;
    }
    config.appCallbackUrl = url;
    config.amazonDomain = AMAZON_DOMAINS.includes(req.body.amazonDomain) ? req.body.amazonDomain : "amazon.com";
    saveConfig(config);
    res.redirect("/");
});

app.get("/reset", (req, res) => {
    config = {};
    saveConfig(config);
    res.redirect("/");
});

app.get("/status", (req, res) => {
    res.json(loginState);
});

app.get("/cookie-success", (req, res) => {
    res.send(
        htmlPage(
            "Echo Speaks Login - Finishing Up",
            `<p id="msg">Login captured! Finishing up and sending the token to Hubitat&hellip;</p>
            <script>
                function poll() {
                    fetch('/status').then(r => r.json()).then(data => {
                        var el = document.getElementById('msg');
                        if (data.status === 'success') {
                            el.innerHTML = '<span class="ok">&#9989; Sent to Hubitat successfully. You can close this window.</span>';
                        } else if (data.status === 'error') {
                            el.innerHTML = '<span class="err">&#10060; ' + (data.message || 'Something went wrong.') + '</span>';
                        } else {
                            setTimeout(poll, 1500);
                        }
                    }).catch(() => setTimeout(poll, 1500));
                }
                poll();
            </script>`,
        ),
    );
});

function startProxyIfNeeded() {
    if (proxyStarted) return;
    proxyStarted = true;

    const proxyOwnIp = process.env.PROXY_HOST || getLocalIp();
    const alexaOptions = {
        secure: false, // <--- added to allow self‑signed certs if any
        proxyOwnIp,
        proxyListenBind: "0.0.0.0",
        proxyPort: ACTUAL_PORT,
        formerDataStorePath: FORMER_DATA_STORE_PATH,
        protocolPrefix: "http",
        useHeroku: false,
        amazonPage: config.amazonDomain || "amazon.com",
        baseAmazonPage: config.amazonDomain || "amazon.com",
        acceptLanguage: process.env.REGION_LOCALE || "en-US",
        regDataAppName: "Echo Speaks",
        setupProxy: true,
        proxyRootPath: "/proxy",
        expressInstance: app,
        logger: process.env.DEBUG ? console.log : undefined,
    };

    // NOTE: this callback fires more than once - first (informational, safe
    // to ignore) once the proxy middleware is mounted, then again with the
    // final result once the user completes the Amazon login in the browser.
    alexaCookie.generateAlexaCookie(undefined, undefined, alexaOptions, (err, result) => {
        if (err && (!result || String(err.message).startsWith("You can try to get the cookie manually by opening"))) {
            // Informational "proxy is ready" callback - nothing to do yet.
            return;
        }

        if (!result || !result.csrf || !(result.cookie || result.localCookie)) {
            console.error("Amazon login failed:", (err && err.message) || "unknown error");
            loginState = { status: "error", message: "Amazon login failed. Check the terminal for details and try again." };
            return;
        }

        console.log("Amazon login captured successfully. Sending token to Hubitat...");
        forwardCookieToHub(result)
            .then(() => {
                console.log("Token sent to Hubitat successfully.");
                loginState = { status: "success", message: "" };
            })
            .catch((sendErr) => {
                console.error("Failed to send token to Hubitat:", sendErr.message);
                loginState = { status: "error", message: "Login succeeded but sending the token to Hubitat failed: " + sendErr.message };
            })
            .then(() => alexaCookie.stopProxyServer());
    });
}

function forwardCookieToHub(cookieData) {
    let callbackUrl = config.appCallbackUrl || "";
    let url;
    if (callbackUrl.includes("/receiveData?")) {
        url = callbackUrl.replace(/\/receiveData\?/, "/cookie?");
    } else if (/\/receiveData$/.test(callbackUrl) || callbackUrl.endsWith("/receiveData")) {
        url = callbackUrl + "?";
    } else {
        console.warn("Callback URL does not contain /receiveData; attempting use original URL");
        url = callbackUrl;
    }
    const options = {
        method: "POST",
        uri: url,
        body: {
            cookieData: cookieData,
            version: packageFile.version,
            onHeroku: false,
            isLocal: true,
            serverUrl: `http://${getLocalIp()}:${ACTUAL_PORT}`,
        },
        json: true,
        timeout: 15000,
    };
    return reqPromise(options);
}

function openBrowser(url) {
    const platform = process.platform;
    let cmd;
    let args;
    if (platform === "win32") {
        // "start" is a cmd.exe builtin; the empty string is the window title arg it expects.
        cmd = "cmd";
        args = ["/c", "start", "", url];
    } else if (platform === "darwin") {
        cmd = "open";
        args = [url];
    } else {
        cmd = "xdg-open";
        args = [url];
    }
    execFile(cmd, args, (err) => {
        if (err) {
            console.log(`(Could not auto-open a browser - please open ${url} manually.)`);
        }
    });
}

function startListening() {
    const server = app.listen(REQUESTED_PORT, "0.0.0.0");
    server.on("listening", () => {
        ACTUAL_PORT = server.address().port;
        announceAndOpen();
    });
    server.on("error", (err) => {
        if (err.code !== "EADDRINUSE") {
            console.error("Failed to start the login helper:", err.message);
            process.exit(1);
            return;
        }
        console.log(`Port ${REQUESTED_PORT} is already in use, looking for a free port nearby...`);
        findFreePort(REQUESTED_PORT + 1, REQUESTED_PORT + 100, "0.0.0.0")
            .then(([freePort]) => {
                ACTUAL_PORT = freePort;
                const fallbackServer = app.listen(ACTUAL_PORT, "0.0.0.0", () => announceAndOpen());
                fallbackServer.on("error", (fallbackErr) => {
                    console.error("Failed to start the login helper:", fallbackErr.message);
                    process.exit(1);
                });
            })
            .catch((findErr) => {
                console.error("Could not find a free port to listen on:", findErr.message);
                process.exit(1);
            });
    });
}

function announceAndOpen() {
    const url = `http://${getLocalIp()}:${ACTUAL_PORT}/`;
    console.log(`Echo Speaks Login Helper listening on ${url}`);
    console.log("Opening that URL in your default browser now. Ctrl+C to stop this window when you're done.");
    openBrowser(url);
}

startListening();
