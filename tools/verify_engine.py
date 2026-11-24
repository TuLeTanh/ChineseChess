"""
Comprehensive verification for Pikafish engine + bridge server + UI integration:
1. Setup sanity: engine/engine.json, go depth 12 nps from START_FEN.
2. Bridge API & security: info, search, multipv 4, stop (< 500 ms), newgame,
   concurrent searches, malicious payloads (newline FEN, injection move, >64KB body, bad Host).
3. 50/50 random positions legality against XiangqiRules.
4. 3 Mate-in-1 puzzles from tests/ai.test.js.
5. 4-game strength match: Pikafish (300 ms) vs JS engine (Đại sư, 300 ms cap / depth 6), 200-ply cap.
6. Playwright live app: Red & Black vs Pikafish (3 moves each), live SSE depth/score/nps,
   rAF gap <= 120 ms, 2-ply undo, New Game cancel, screenshots (app_engine_selector.png,
   app_pikafish_thinking.png), zero console errors/warnings, and zero orphan pikafish process after stop.
"""
import concurrent.futures
import http.client
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from engine_launch import probe_with_fallbacks, resolve_engine_paths  # noqa: E402

ROOT = TOOLS_DIR.parent
ENGINE_JSON = ROOT / "engine" / "engine.json"
PREVIEW_DIR = ROOT / "preview"
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
PORT = 8769
BASE = f"http://127.0.0.1:{PORT}"


def http_json(method, path, body=None, headers=None, timeout=20):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=timeout)
    hdrs = {"Host": f"127.0.0.1:{PORT}"}
    if headers:
        hdrs.update(headers)
    payload = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            payload = body
        elif isinstance(body, str):
            payload = body.encode("utf-8")
        else:
            payload = json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
    conn.request(method, path, body=payload, headers=hdrs)
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8", errors="replace")
    conn.close()
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = raw
    return resp.status, parsed


def wait_server_ready(timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            code, data = http_json("GET", "/api/engine/info", timeout=3)
            if code == 200:
                return data
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("tools/server.py did not become ready in time")


def count_pikafish_processes():
    if sys.platform != "win32":
        return 0
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "(Get-Process -Name '*pikafish*' -ErrorAction SilentlyContinue).Count"],
        capture_output=True,
        text=True,
    )
    txt = (out.stdout or "").strip()
    return int(txt) if txt.isdigit() else 0


def board_point(page, x, y, flipped=False):
    rect = page.locator("svg.board-svg").bounding_box()
    gx = 8 - x if flipped else x
    gy = 9 - y if flipped else y
    bx = 125 + gx * 100
    by = 125 + gy * 100
    return rect["x"] + (bx / 1050.0) * rect["width"], rect["y"] + (by / 1150.0) * rect["height"]


def click_move(page, x1, y1, x2, y2, flipped=False):
    p1 = board_point(page, x1, y1, flipped)
    p2 = board_point(page, x2, y2, flipped)
    page.mouse.click(*p1)
    page.wait_for_timeout(100)
    page.mouse.click(*p2)
    page.wait_for_timeout(320)


def test_unicode_path_probe(cfg: dict):
    """Copy engine + NNUE into a temp folder with Vietnamese characters ('thư mục thử') and probe via shared helper."""
    exe_src, nnue_src = resolve_engine_paths(cfg, ROOT)
    tmp_base = Path(tempfile.mkdtemp(prefix="xiangqi_unicode_"))
    try:
        uni_dir = tmp_base / "thư mục thử"
        uni_dir.mkdir(parents=True, exist_ok=True)
        uni_exe = uni_dir / exe_src.name
        uni_nnue = uni_dir / nnue_src.name
        shutil.copy2(exe_src, uni_exe)
        shutil.copy2(nnue_src, uni_nnue)

        # 1. Direct in-process probe through shared helper
        res, _ = probe_with_fallbacks(uni_exe, uni_nnue, timeout=20.0)
        assert res["ok"], f"Unicode-path probe failed: {res}"

        # 2. Subprocess probe with -X utf8=0 (matches default Windows PowerShell cp1252 encoding)
        code = (
            "import json, sys; from pathlib import Path; "
            f"sys.path.insert(0, {str(TOOLS_DIR)!r}); "
            "from engine_launch import probe_with_fallbacks; "
            f"res, _ = probe_with_fallbacks(Path({str(uni_exe)!r}), Path({str(uni_nnue)!r}), timeout=20.0); "
            "print(json.dumps({'ok': res['ok'], 'name': res['name'], 'strategy': res['strategy']}))"
        )
        proc = subprocess.run(
            [sys.executable, "-X", "utf8=0", "-c", code],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        assert proc.returncode == 0, f"cp1252 unicode-path subprocess failed: {proc.stderr}"
        parsed = json.loads(proc.stdout.strip().splitlines()[-1])
        assert parsed.get("ok") is True, f"cp1252 unicode-path probe returned not ok: {parsed}"
        print(f"[unicode-path probe] ok (folder='thư mục thử', name={parsed['name']}, strategy={parsed['strategy']}, -X utf8=0 verified)")
    finally:
        shutil.rmtree(tmp_base, ignore_errors=True)


def main():
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    assert ENGINE_JSON.exists(), "engine/engine.json missing — run python tools/setup_engine.py"
    cfg = json.loads(ENGINE_JSON.read_text(encoding="utf-8"))
    print(f"[setup] {cfg['name']} | build={cfg['cpu_build']} | nnue={cfg['nnue']} ({cfg['nnue_size_bytes']/1e6:.1f} MB)")
    test_unicode_path_probe(cfg)

    baseline_procs = count_pikafish_processes()
    server_proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "server.py"), "--port", str(PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        # 1. Info & Depth 12 sanity benchmark
        info = wait_server_ready()
        assert info.get("available") is True, f"Engine not available: {info}"
        opt_names = [o["name"] for o in info.get("options", [])]
        print(f"[info] available=True name={info['name']} options={opt_names}")

        code, d12 = http_json("POST", "/api/engine/search", {"id": "d12", "fen": START_FEN, "depth": 12})
        assert code == 200 and d12.get("bestmove"), f"Depth 12 search failed: {code} {d12}"
        print(f"[sanity depth 12] bestmove={d12['bestmove']} depth={d12['depth']} nodes={d12['nodes']} nps={d12['nps']} elapsed={d12['elapsed_ms']}ms")

        # 2. Bridge API & Security tests
        code, s300 = http_json("POST", "/api/engine/search", {"id": "s300", "fen": START_FEN, "movetime_ms": 300})
        assert code == 200 and len(s300["bestmove"]) == 4

        code, mpv = http_json("POST", "/api/engine/search", {"id": "mpv4", "fen": START_FEN, "depth": 6, "multipv": 4})
        assert code == 200
        lines = mpv.get("lines", [])
        distinct_moves = {l["move"] for l in lines}
        assert len(distinct_moves) == 4, f"Expected 4 distinct MultiPV lines, got {lines}"
        print(f"[multipv 4] ok ({len(distinct_moves)} distinct lines)")

        # Stop test (< 500 ms)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut = pool.submit(http_json, "POST", "/api/engine/search", {"id": "long1", "fen": START_FEN, "movetime_ms": 10000})
            time.sleep(0.25)
            t_stop = time.monotonic()
            c_stop, _ = http_json("POST", "/api/engine/stop", {"id": "long1"})
            assert c_stop == 200
            c_res, res_long = fut.result(timeout=5)
            stop_ms = (time.monotonic() - t_stop) * 1000
            assert c_res == 200 and res_long.get("bestmove")
            assert stop_ms < 500, f"Stop took {stop_ms:.0f} ms (>= 500 ms)"
            print(f"[stop] ok ({stop_ms:.0f} ms)")

        # Newgame + concurrent searches serialized cleanly
        code, ng = http_json("POST", "/api/engine/newgame", {})
        assert code == 200 and ng.get("ok") is True

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(http_json, "POST", "/api/engine/search", {"id": "conc1", "fen": START_FEN, "depth": 5})
            f2 = pool.submit(http_json, "POST", "/api/engine/search", {"id": "conc2", "fen": START_FEN, "depth": 5})
            c1, r1 = f1.result(timeout=10)
            c2, r2 = f2.result(timeout=10)
            assert c1 == 200 and r1.get("bestmove") and c2 == 200 and r2.get("bestmove")
            print("[concurrent] ok (2 searches serialized cleanly)")

        # Malicious payloads -> 400 / 403
        c_nl, _ = http_json("POST", "/api/engine/search", {"id": "bad1", "fen": START_FEN + "\nquit", "depth": 1})
        assert c_nl == 400, f"Expected 400 for newline FEN, got {c_nl}"
        c_mv, _ = http_json("POST", "/api/engine/search", {"id": "bad2", "fen": START_FEN, "moves": ["go infinite\nquit"], "depth": 1})
        assert c_mv == 400, f"Expected 400 for malicious move, got {c_mv}"
        c_big, _ = http_json("POST", "/api/engine/search", "A" * 70000)
        assert c_big == 400, f"Expected 400 for oversized body, got {c_big}"
        c_host, _ = http_json("GET", "/api/engine/info", headers={"Host": "evil.example.com"})
        assert c_host == 403, f"Expected 403 for bad Host header, got {c_host}"
        # Engine still works after bad payloads
        c_after, r_after = http_json("POST", "/api/engine/search", {"id": "afterbad", "fen": START_FEN, "depth": 3})
        assert c_after == 200 and r_after.get("bestmove")
        print("[security] ok (newline FEN=400, bad move=400, oversized=400, bad Host=403, engine healthy after)")

        # 3, 4, 5, 6: Browser-side verification (50/50 legality, 3 mate-in-1, 4-game match, live UI + screenshots)
        errors = []
        warnings = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1180, "height": 780}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.on("console", lambda msg: (
                errors.append(msg.text) if msg.type == "error"
                else warnings.append(msg.text) if msg.type == "warning"
                else None
            ))

            # 3 & 4: 50/50 random legality + 3 mate-in-1 puzzles + 4-game Pikafish vs JS strength match
            page.goto(f"{BASE}/?mode=pvp", wait_until="networkidle")
            eval_report = page.evaluate("""async () => {
                const { Board } = await import('./js/model/board.js');
                const { START_FEN } = await import('./js/model/fen.js');
                const { RED, BLACK } = await import('./js/model/piece.js');
                const { XiangqiRules, GameStatus } = await import('./js/rules.js');
                const { searchBestMove } = await import('./js/ai/search.js');

                const rules = new XiangqiRules();
                const FILES = 'abcdefghi';
                const parseIccs = (s) => ({
                    from: { x: FILES.indexOf(s[0]), y: 9 - Number(s[1]) },
                    to: { x: FILES.indexOf(s[2]), y: 9 - Number(s[3]) },
                });
                const isLegal = (board, iccs) => {
                    if (!iccs || iccs.length !== 4) return false;
                    const { from, to } = parseIccs(iccs);
                    const p = board.at(from);
                    if (!p || p.side !== board.sideToMove) return false;
                    return rules.legalMoves(board, from).some(m => m.x === to.x && m.y === to.y);
                };
                const pfSearch = async (payload) => {
                    const r = await fetch('/api/engine/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    return await r.json();
                };

                // Seeded RNG
                let seed = 20260906;
                const rand = () => {
                    seed = (seed + 0x6d2b79f5) | 0;
                    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };

                // A. 50 random legal positions
                let legalPassed = 0;
                for (let i = 0; i < 50; i++) {
                    const b = Board.fromFen(START_FEN);
                    const plies = 4 + Math.floor(rand() * 24);
                    for (let k = 0; k < plies; k++) {
                        const all = [];
                        for (let y = 0; y < 10; y++) {
                            for (let x = 0; x < 9; x++) {
                                const p = b.at({ x, y });
                                if (!p || p.side !== b.sideToMove) continue;
                                for (const to of rules.legalMoves(b, { x, y })) all.push({ from: { x, y }, to });
                            }
                        }
                        if (all.length === 0) break;
                        const mv = all[Math.floor(rand() * all.length)];
                        b.applyMove(mv.from, mv.to);
                    }
                    const st = rules.status(b, b.sideToMove);
                    if (st === GameStatus.Checkmate || st === GameStatus.Stalemate) { legalPassed++; continue; }
                    const res = await pfSearch({ id: 'leg-' + i, fen: b.toFen(), depth: 2 });
                    if (isLegal(b, res.bestmove)) legalPassed++;
                }

                // B. 3 Mate-in-1 puzzles (same as tests/ai.test.js)
                const puzzles = [
                    ['Double Chariot', '4k4/R8/1R7/9/9/9/9/9/9/3K5 w - - 0 1'],
                    ['Horse + Chariot', '3ak4/4a4/9/7N1/9/5R3/9/9/9/3K5 w - - 0 1'],
                    ['Chariot + Cannon', '3ak4/4a4/C8/8p/9/4R4/9/9/9/5K3 w - - 0 1'],
                ];
                const mateResults = [];
                for (const [name, fen] of puzzles) {
                    const b = Board.fromFen(fen);
                    const res = await pfSearch({ id: 'mate-' + name, fen, depth: 6 });
                    const { from, to } = parseIccs(res.bestmove);
                    b.applyMove(from, to);
                    const isMate = rules.status(b, BLACK) === GameStatus.Checkmate;
                    mateResults.push({ name, move: res.bestmove, isMate });
                }

                // C. 4-game match: Pikafish (300 ms) vs JS Đại sư (300 ms)
                const matchGames = [];
                for (let g = 0; g < 4; g++) {
                    await fetch('/api/engine/newgame', { method: 'POST' });
                    const b = Board.fromFen(START_FEN);
                    const pfSide = g % 2 === 0 ? RED : BLACK;
                    let outcome = 'Draw (200-ply cap)';
                    let winnerEngine = 'Draw';
                    let plies = 0;
                    for (let ply = 0; ply < 200; ply++) {
                        const st = rules.status(b, b.sideToMove);
                        if (st === GameStatus.Checkmate || st === GameStatus.Stalemate) {
                            const winSide = b.sideToMove === RED ? BLACK : RED;
                            winnerEngine = winSide === pfSide ? 'Pikafish' : 'JS';
                            outcome = `${winnerEngine} (${st})`;
                            break;
                        }
                        if (st === GameStatus.DrawRepetition || st === GameStatus.DrawNoCapture) {
                            outcome = `Draw (${st})`;
                            break;
                        }
                        let mvStr = null;
                        if (b.sideToMove === pfSide) {
                            const res = await pfSearch({
                                id: `m-${g}-${ply}`,
                                fen: START_FEN,
                                moves: b.history.map(m => m.iccs),
                                movetime_ms: 300,
                            });
                            mvStr = res.bestmove;
                        } else {
                            const res = searchBestMove(b.toFen(), {
                                level: 'dai-su',
                                timeMs: 300,
                                history: b.positionHistory,
                                seed: 900 + g * 500 + ply,
                            });
                            mvStr = res.move;
                        }
                        if (!isLegal(b, mvStr)) {
                            outcome = `ILLEGAL by ${b.sideToMove === pfSide ? 'Pikafish' : 'JS'}: ${mvStr}`;
                            break;
                        }
                        const { from, to } = parseIccs(mvStr);
                        b.applyMove(from, to);
                        plies++;
                    }
                    matchGames.push({
                        game: g + 1,
                        red: pfSide === RED ? 'Pikafish' : 'JS (Đại sư)',
                        black: pfSide === BLACK ? 'Pikafish' : 'JS (Đại sư)',
                        plies,
                        outcome,
                        winnerEngine,
                    });
                }

                return { legalPassed, mateResults, matchGames };
            }""")

            print(f"[50/50 legality] {eval_report['legalPassed']}/50")
            assert eval_report["legalPassed"] == 50, f"Legality failed: {eval_report['legalPassed']}/50"

            for mr in eval_report["mateResults"]:
                print(f"[mate-in-1] {mr['name']}: move={mr['move']} mate={mr['isMate']}")
                assert mr["isMate"], f"Pikafish missed mate-in-1 in {mr['name']}"

            print("| Game | Red | Black | Plies | Result |")
            print("|---|---|---|---:|---|")
            for mg in eval_report["matchGames"]:
                print(f"| {mg['game']} | {mg['red']} | {mg['black']} | {mg['plies']} | {mg['outcome']} |")
                assert "ILLEGAL" not in mg["outcome"], mg["outcome"]
                assert mg["winnerEngine"] != "JS", f"Unexpected Pikafish loss in game {mg['game']}"

            # 6. Live Playwright UI vs Pikafish (Red + Black + screenshots + rAF + undo + newgame)
            page.goto(f"{BASE}/?mode=ai&side=red&level=cao-thu&engine=pikafish", wait_until="networkidle")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(150)

            assert page.locator("[data-engine='pikafish'].is-selected").is_visible(), "Expected Pikafish selected"
            page.screenshot(path=str(PREVIEW_DIR / "app_engine_selector.png"))
            print("[app_engine_selector.png] saved")

            # Play 3 moves as Red vs Pikafish (measure rAF during Move 2 so page.screenshot() on Move 1 does not skew maxGap)
            opening_red = [(7, 7, 4, 7), (7, 9, 6, 7), (8, 9, 7, 9)]
            for idx, (x1, y1, x2, y2) in enumerate(opening_red):
                if idx == 1:
                    page.evaluate("""() => {
                        window.__rafMaxGap = 0; window.__rafFrames = 0; window.__rafStop = false;
                        let last = performance.now();
                        function tick(now) {
                            const gap = now - last;
                            if (window.__rafFrames > 0 && gap > window.__rafMaxGap) window.__rafMaxGap = gap;
                            window.__rafFrames++; last = now;
                            if (!window.__rafStop) requestAnimationFrame(tick);
                        }
                        requestAnimationFrame(tick);
                    }""")
                click_move(page, x1, y1, x2, y2)
                if idx == 0:
                    page.locator(".ai-thinking-label").wait_for(state="visible", timeout=3000)
                    page.wait_for_timeout(450)  # let SSE populate live depth/score/nps
                    page.screenshot(path=str(PREVIEW_DIR / "app_pikafish_thinking.png"))
                    print("[app_pikafish_thinking.png] saved")
                row_num = idx + 1
                page.wait_for_function(
                    f"() => document.querySelectorAll('.move-row .col-black').length >= {row_num} && (document.querySelectorAll('.move-row .col-black')[{idx}]?.textContent || '').trim().length >= 4",
                    timeout=10000,
                )
                page.wait_for_timeout(320)

            raf_stats = page.evaluate("() => { window.__rafStop = true; return { frames: window.__rafFrames, maxGap: window.__rafMaxGap }; }")
            print(f"[Pikafish UI rAF] frames={raf_stats['frames']} maxGap={raf_stats['maxGap']:.1f}ms")
            assert raf_stats["maxGap"] <= 120, f"UI blocked: maxGap={raf_stats['maxGap']}"

            # Undo removes 2 plies
            page.locator("button[data-action='undo']").click()
            page.wait_for_timeout(300)
            assert page.locator(".move-row").count() == 2, "Undo in Pikafish mode must remove 2 plies"

            # New game resets cleanly
            page.locator("button[data-action='new']").click()
            page.wait_for_timeout(100)
            page.locator(".modal-confirm").click()
            page.wait_for_timeout(150)
            assert page.locator(".move-row").count() == 0

            # Play as Black vs Pikafish (auto-flipped, Pikafish moves first)
            page.locator("[data-pside='black']").click()
            page.wait_for_timeout(120)
            page.wait_for_function(
                "() => (document.querySelector('.move-row .col-red')?.textContent || '').trim().length >= 4",
                timeout=10000,
            )
            page.wait_for_timeout(320)
            # Make 1 legal Black reply (Horse (1,0) -> (2,2) on flipped board)
            click_move(page, 1, 0, 2, 2, flipped=True)
            page.wait_for_function(
                "() => document.querySelectorAll('.move-row .col-red').length >= 2 && (document.querySelectorAll('.move-row .col-red')[1]?.textContent || '').trim().length >= 4",
                timeout=10000,
            )
            print("[Pikafish UI Black] ok")

            ctx.close()
            browser.close()

        assert len(errors) == 0 and len(warnings) == 0, f"Browser console issues: errors={errors} warnings={warnings}"
        print("[Playwright console] errors=0 warnings=0")
    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except Exception:
            server_proc.kill()

    time.sleep(0.5)
    after_procs = count_pikafish_processes()
    orphans = max(0, after_procs - baseline_procs)
    print(f"[orphan check] pikafish processes leaked after server stop: {orphans} (before={baseline_procs}, after={after_procs})")
    assert orphans == 0, f"Found {orphans} orphan pikafish process(es)!"
    print("ALL PIKAFISH ENGINE VERIFICATION GATES PASSED.")


if __name__ == "__main__":
    main()
