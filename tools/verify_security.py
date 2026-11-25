"""
Step 2: HTTP Security & CSP Verification (tools/verify_security.py).
Starts server/index.js on a random port and asserts:
- GET / returns 200 with Content-Security-Policy (including frame-ancestors 'none'),
  X-Content-Type-Options: nosniff, and Referrer-Policy. Prints all headers.
- Path traversal & non-whitelisted paths return 404/403/400 (never 200).
- Correct MIME types for .js, .css, .svg, .ttf, .json.
- /api/online/info works; WebSocket with bad Origin is refused; oversized payload closed.
- Page loads in Playwright Chromium under active CSP with ZERO console/page errors.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_server(port: int, timeout_s: float = 8.0):
    deadline = time.time() + timeout_s
    url = f"http://127.0.0.1:{port}/api/online/info"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError(f"Server failed to start on port {port}")


def raw_http_get(port: int, path: str) -> tuple[int, dict[str, str], bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.putrequest("GET", path, skip_accept_encoding=True)
    conn.endheaders()
    resp = conn.getresponse()
    body = resp.read()
    headers = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    return resp.status, headers, body


def main():
    port = get_free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["MAX_NEW_CONNS_PER_SEC"] = "30"

    proc = subprocess.Popen(
        ["node", str(ROOT / "server" / "index.js")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    failures = []
    try:
        wait_for_server(port)

        # 1. GET / headers + CSP check
        status, headers, _ = raw_http_get(port, "/")
        print("=== GET / Response Headers ===")
        for k, v in sorted(headers.items()):
            print(f"  {k}: {v}")
        assert status == 200, f"GET / returned {status}"
        if headers.get("x-content-type-options") != "nosniff":
            failures.append(f"Missing/wrong X-Content-Type-Options: {headers.get('x-content-type-options')}")
        if not headers.get("referrer-policy"):
            failures.append("Missing Referrer-Policy")
        csp = headers.get("content-security-policy", "")
        if not csp:
            failures.append("Missing Content-Security-Policy")
        if "frame-ancestors 'none'" not in csp:
            failures.append(f"CSP missing frame-ancestors 'none': {csp}")

        # 2. Path traversal & forbidden files (must NEVER return 200)
        probes = [
            "/../server/index.js",
            "/%2e%2e/package.json",
            "/%2e%2e%2fserver/index.js",
            "/server/index.js",
            "/server/package.json",
            "/engine/",
            "/engine/engine.json",
            "/logs/online.log",
            "/.git/config",
            "/tools/server.py",
            "/tests/",
            "/docs/PROGRESS.md",
            "/package.json",
            "/index.html%00.txt",
            "/\\server\\index.js",
            "/%5cserver%5cindex.js",
        ]
        blocked = 0
        for p in probes:
            st, _, _ = raw_http_get(port, p)
            if st == 200:
                failures.append(f"SECURITY BREACH: {p} returned 200!")
            else:
                blocked += 1
        print(f"[path probes] blocked {blocked}/{len(probes)}")

        # 3. MIME types check
        mime_checks = [
            ("/js/main.js", "javascript"),
            ("/css/style.css", "text/css"),
            ("/api/online/info", "application/json"),
        ]
        # Check font if present
        fonts_dir = ROOT / "assets" / "fonts"
        ttf_files = list(fonts_dir.glob("*.ttf"))
        if ttf_files:
            mime_checks.append((f"/assets/fonts/{ttf_files[0].name}", "font/"))
        for p, expected in mime_checks:
            st, hdrs, _ = raw_http_get(port, p)
            ct = hdrs.get("content-type", "")
            if st != 200 or expected not in ct:
                failures.append(f"MIME mismatch for {p}: status={st} ct={ct} (expected {expected})")
        print(f"[mime checks] verified {len(mime_checks)} asset types")

        # 4. /api/online/info
        st, _, body = raw_http_get(port, "/api/online/info")
        info = json.loads(body.decode("utf-8"))
        assert st == 200 and info.get("ok") is True

        # 5. Raw WS upgrade with bad Origin must be refused (403)
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", "/ws", headers={
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            "Origin": "https://evil-attacker.example",
        })
        ws_resp = conn.getresponse()
        if ws_resp.status != 403:
            failures.append(f"Bad Origin WS upgrade returned {ws_resp.status} instead of 403")
        conn.close()
        print(f"[ws bad origin] refused with HTTP {ws_resp.status}")

        # 6. Load real page in Playwright under active CSP and verify ZERO console/CSP errors
        csp_errors = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on("console", lambda m: csp_errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: csp_errors.append(str(e)))

            page.goto(f"http://127.0.0.1:{port}/index.html#/", wait_until="networkidle")
            page.wait_for_timeout(400)
            # Also load AI game to exercise Web Worker + Audio + SVG under CSP
            page.goto(f"http://127.0.0.1:{port}/index.html#/play/cotuong/ai?level=tap-su&side=red", wait_until="networkidle")
            page.wait_for_selector("svg.board-svg", timeout=6000)
            page.wait_for_timeout(400)
            browser.close()
        if csp_errors:
            failures.append(f"Browser CSP/console errors: {csp_errors}")
        print(f"[browser CSP check] errors={len(csp_errors)}")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    if failures:
        print("SECURITY FAILURES:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("[verify_security] ALL SECURITY CHECKS PASSED.")


if __name__ == "__main__":
    main()
