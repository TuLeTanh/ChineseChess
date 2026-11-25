"""Shared Playwright + CDP helpers for mobile & touch verification (B2).

Provides:
- Device table (portrait phones, landscape phones, tablets, desktop) + FULL/BASIC sets
- Static HTTP server helper (ephemeral port)
- Context factory with strict console/pageerror/warning failure collection
- Real CDP Input.dispatchTouchEvent helpers (single-touch, interpolated drag, multi-touch)
- Screen-to-board coordinate helpers reading the live SVG rect & viewBox
- CPU throttling (Emulation.setCPUThrottlingRate) and rAF frame-gap sampler
- Layout metrics collector (M1..M9), contrast calculator, and screenshot helper
"""
from __future__ import annotations

import functools
import http.server
import math
import random
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PREVIEW_DIR = ROOT / "preview" / "mobile"
BASELINE_DIR = ROOT / "preview" / "mobile_baseline"


@dataclass(frozen=True)
class DeviceSpec:
    name: str
    width: int
    height: int
    dpr: float
    is_mobile: bool = True
    has_touch: bool = True
    category: str = "phone_portrait"


DEVICES: list[DeviceSpec] = [
    # Portrait phones
    DeviceSpec("320x568", 320, 568, 2.0, True, True, "phone_portrait"),
    DeviceSpec("360x640", 360, 640, 3.0, True, True, "phone_portrait"),
    DeviceSpec("360x740", 360, 740, 3.0, True, True, "phone_portrait"),
    DeviceSpec("375x667", 375, 667, 2.0, True, True, "phone_portrait"),
    DeviceSpec("inapp_390x700", 390, 700, 3.0, True, True, "phone_portrait"),
    DeviceSpec("390x844", 390, 844, 3.0, True, True, "phone_portrait"),
    DeviceSpec("412x915", 412, 915, 2.6, True, True, "phone_portrait"),
    DeviceSpec("430x932", 430, 932, 3.0, True, True, "phone_portrait"),
    # Landscape phones
    DeviceSpec("568x320", 568, 320, 2.0, True, True, "phone_landscape"),
    DeviceSpec("667x375", 667, 375, 2.0, True, True, "phone_landscape"),
    DeviceSpec("844x390", 844, 390, 3.0, True, True, "phone_landscape"),
    DeviceSpec("915x412", 915, 412, 2.6, True, True, "phone_landscape"),
    # Tablets
    DeviceSpec("768x1024", 768, 1024, 2.0, True, True, "tablet"),
    DeviceSpec("820x1180", 820, 1180, 2.0, True, True, "tablet"),
    DeviceSpec("1024x768", 1024, 768, 2.0, True, True, "tablet"),
    DeviceSpec("1180x820", 1180, 820, 2.0, True, True, "tablet"),
    # Desktop
    DeviceSpec("960x680", 960, 680, 1.0, False, False, "desktop"),
    DeviceSpec("1180x780", 1180, 780, 1.0, False, False, "desktop"),
    DeviceSpec("1600x900", 1600, 900, 1.0, False, False, "desktop"),
]

DEVICE_BY_NAME: dict[str, DeviceSpec] = {d.name: d for d in DEVICES}

FULL_SET_NAMES = ("320x568", "360x640", "390x844", "844x390", "820x1180", "1180x820")
DESKTOP_NAMES = ("960x680", "1180x780", "1600x900")
BASIC_SET_NAMES = tuple(
    d.name for d in DEVICES if d.name not in FULL_SET_NAMES and d.name not in DESKTOP_NAMES
)


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        pass

    def do_GET(self) -> None:
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith("/api/engine/info"):
            body = b'{"available":false}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api/online/info"):
            body = b'{"ok":true,"players":0,"version":"1.0"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def start_static_server(directory: Path = ROOT) -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(_QuietHandler, directory=str(directory))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, f"http://127.0.0.1:{port}"


def make_seeded_rng(seed: int = 20261125) -> random.Random:
    return random.Random(seed)


def create_device_context(browser, spec: DeviceSpec, extra: dict | None = None):
    opts: dict[str, Any] = {
        "viewport": {"width": spec.width, "height": spec.height},
        "device_scale_factor": spec.dpr,
        "is_mobile": spec.is_mobile,
        "has_touch": spec.has_touch,
    }
    if extra:
        opts.update(extra)
    return browser.new_context(**opts)


def attach_error_listener(page) -> list[str]:
    """Collect console errors, console warnings, and uncaught page errors."""
    errors: list[str] = []

    def on_console(msg):
        if msg.type in ("error", "warning"):
            txt = msg.text
            # Ignore benign headless Chromium GPU/font fallback noise if any? No: strict zero!
            errors.append(f"console.{msg.type}: {txt}")

    def on_pageerror(err):
        errors.append(f"pageerror: {err}")

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    return errors


def save_screenshot(page, rel_name: str, out_dir: Path = PREVIEW_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / rel_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(dest))
    return dest


# ---------------------------------------------------------------------------
# Real CDP Touch Helpers (Chromium)
# ---------------------------------------------------------------------------

class CdpTouch:
    """Dispatches genuine Input.dispatchTouchEvent via CDP."""

    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)

    def _pt(self, x: float, y: float, tid: int = 0) -> dict[str, Any]:
        return {
            "x": round(float(x), 2),
            "y": round(float(y), 2),
            "radiusX": 14,
            "radiusY": 14,
            "force": 1.0,
            "id": tid,
        }

    def start(self, x: float, y: float, tid: int = 0) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchStart", "touchPoints": [self._pt(x, y, tid)]},
        )

    def move(self, x: float, y: float, tid: int = 0) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [self._pt(x, y, tid)]},
        )

    def end(self, points: list[dict[str, Any]] | None = None) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchEnd", "touchPoints": points or []},
        )

    def cancel(self) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchCancel", "touchPoints": []},
        )

    def tap(self, x: float, y: float, hold_ms: int = 40) -> None:
        self.start(x, y, 0)
        if hold_ms > 0:
            self.page.wait_for_timeout(hold_ms)
        self.end()

    def drag(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        steps: int = 12,
        step_ms: int = 16,
        end_touch: bool = True,
        on_step=None,
    ) -> None:
        self.start(x0, y0, 0)
        self.page.wait_for_timeout(max(8, step_ms))
        for i in range(1, steps + 1):
            t = i / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            self.move(x, y, 0)
            if on_step:
                on_step(i, x, y)
            if step_ms > 0:
                self.page.wait_for_timeout(step_ms)
        if end_touch:
            self.end()

    def multi_start(self, pts: list[tuple[float, float, int]]) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchStart", "touchPoints": [self._pt(x, y, tid) for x, y, tid in pts]},
        )

    def multi_move(self, pts: list[tuple[float, float, int]]) -> None:
        self.cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [self._pt(x, y, tid) for x, y, tid in pts]},
        )

    def set_cpu_throttle(self, rate: float) -> None:
        self.cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(rate)})


# ---------------------------------------------------------------------------
# Board Coordinate Helpers
# ---------------------------------------------------------------------------

def get_board_geom(page) -> dict[str, float]:
    """Return live screen-space board geometry from svg.board-svg + its viewBox."""
    return page.evaluate(
        """() => {
            const svg = document.querySelector('svg.board-svg');
            if (!svg) return null;
            const r = svg.getBoundingClientRect();
            const vb = (svg.getAttribute('viewBox') || '0 0 1050 1150').trim().split(/\\s+/).map(Number);
            const [vx, vy, vw, vh] = vb.length === 4 ? vb : [0, 0, 1050, 1150];
            const scaleX = r.width / vw;
            const scaleY = r.height / vh;
            const flipped = Boolean(
                document.querySelector('g.layer-board-base')?.getAttribute('transform')?.includes('180')
            );
            return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                vx, vy, vw, vh,
                scaleX, scaleY,
                cellX: 100 * scaleX,
                cellY: 100 * scaleY,
                flipped,
            };
        }"""
    )


def square_to_client(geom: dict[str, float], col: int, row: int) -> tuple[float, float]:
    """Convert logical board square (col 0..8, row 0..9) to CSS client (x, y)."""
    ux = 125.0 + col * 100.0
    uy = 125.0 + row * 100.0
    if geom.get("flipped"):
        ux = 1050.0 - ux
        uy = 1150.0 - uy
    cx = geom["left"] + (ux - geom["vx"]) * geom["scaleX"]
    cy = geom["top"] + (uy - geom["vy"]) * geom["scaleY"]
    return cx, cy


# ---------------------------------------------------------------------------
# rAF Frame-Gap Sampler
# ---------------------------------------------------------------------------

def sample_raf_gaps(page, duration_ms: int = 1200) -> dict[str, float]:
    """Sample requestAnimationFrame frame gaps over duration_ms and return stats."""
    return page.evaluate(
        """(dur) => new Promise((resolve) => {
            const gaps = [];
            let last = null;
            const t0 = performance.now();
            function tick(now) {
                if (last !== null) gaps.push(now - last);
                last = now;
                if (now - t0 < dur) {
                    requestAnimationFrame(tick);
                } else {
                    gaps.sort((a, b) => a - b);
                    const pct = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0;
                    resolve({
                        count: gaps.length,
                        p50: Number(pct(0.50).toFixed(2)),
                        p95: Number(pct(0.95).toFixed(2)),
                        max: Number((gaps.length ? gaps[gaps.length - 1] : 0).toFixed(2)),
                    });
                }
            }
            requestAnimationFrame(tick);
        })""",
        duration_ms,
    )


def start_raf_recorder(page) -> None:
    page.evaluate(
        """() => {
            window.__rafRec = { active: true, gaps: [], last: null };
            function tick(now) {
                if (!window.__rafRec || !window.__rafRec.active) return;
                if (window.__rafRec.last !== null) {
                    window.__rafRec.gaps.push(now - window.__rafRec.last);
                }
                window.__rafRec.last = now;
                requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        }"""
    )


def stop_raf_recorder(page) -> dict[str, float]:
    return page.evaluate(
        """() => {
            const rec = window.__rafRec || { gaps: [] };
            rec.active = false;
            const gaps = [...rec.gaps].sort((a, b) => a - b);
            const pct = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0;
            return {
                count: gaps.length,
                p50: Number(pct(0.50).toFixed(2)),
                p95: Number(pct(0.95).toFixed(2)),
                max: Number((gaps.length ? gaps[gaps.length - 1] : 0).toFixed(2)),
            };
        }"""
    )


# ---------------------------------------------------------------------------
# WCAG Contrast & Image Diff Helpers
# ---------------------------------------------------------------------------

def _rel_lum(r: int, g: int, b: int) -> float:
    def ch(v: int) -> float:
        s = v / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast_ratio(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    l1 = _rel_lum(*rgb1)
    l2 = _rel_lum(*rgb2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def image_diff_percent(path_a: Path, path_b: Path, channel_tol: int = 8) -> float:
    """Return % of pixels differing by > channel_tol in any RGB channel."""
    from PIL import Image

    im_a = Image.open(path_a).convert("RGB")
    im_b = Image.open(path_b).convert("RGB")
    if im_a.size != im_b.size:
        return 100.0
    pa = im_a.tobytes()
    pb = im_b.tobytes()
    total = im_a.size[0] * im_a.size[1]
    diff = 0
    for i in range(0, len(pa), 3):
        if (
            abs(pa[i] - pb[i]) > channel_tol
            or abs(pa[i + 1] - pb[i + 1]) > channel_tol
            or abs(pa[i + 2] - pb[i + 2]) > channel_tol
        ):
            diff += 1
    return (diff * 100.0) / max(1, total)
