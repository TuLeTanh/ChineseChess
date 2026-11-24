"""
Local HTTP + Pikafish UCI bridge server (Python standard library only).
- Serves static game files with proper MIME types (.js, .mjs, .json, .mp3, .wav, .ttf).
- Binds strictly to 127.0.0.1 and validates Host header (localhost / 127.0.0.1 only).
- Manages one lazy Pikafish subprocess with strict UCI input sanitization,
  command lock, SSE live info streaming, crash recovery, and clean shutdown.

Usage:
  python tools/server.py [--port 8000]
"""
import argparse
import atexit
import http.server
import json
import logging
import logging.handlers
import mimetypes
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from engine_launch import launch_engine, resolve_engine_paths  # noqa: E402

ROOT = TOOLS_DIR.parent
ENGINE_JSON = ROOT / "engine" / "engine.json"
LOG_DIR = ROOT / "logs"

MAX_BODY_BYTES = 65536
FEN_RE = re.compile(
    r"^[rnbakcpRNBAKCP1-9]+(?:/[rnbakcpRNBAKCP1-9]+){9}\s+[wb](?:\s+-\s+-\s+\d+\s+\d+)?$"
)
MOVE_RE = re.compile(r"^[a-i][0-9][a-i][0-9]$")
ALLOWED_HOSTS = {"localhost", "127.0.0.1"}

# Ensure proper MIME types on Windows
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/wav", ".wav")


def setup_logger():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("xiangqi.server")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / "server.log",
            maxBytes=512_000,
            backupCount=2,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(handler)
    return logger


LOG = setup_logger()


def parse_uci_option(line: str):
    """Parse a UCI 'option name ... type ...' line into a structured dict."""
    m = re.match(r"^option name (.+?) type (\S+)(.*)$", line.strip())
    if not m:
        return None
    name, opt_type, rest = m.group(1), m.group(2), m.group(3)
    opt = {"name": name, "type": opt_type}
    for key in ("default", "min", "max"):
        km = re.search(rf"\b{key}\s+(\S+)", rest)
        if km:
            val = km.group(1)
            if opt_type == "spin" and re.match(r"^-?\d+$", val):
                val = int(val)
            elif opt_type == "check":
                val = val.lower() == "true"
            opt[key] = val
    return opt


def parse_info_line(line: str):
    """Parse a UCI 'info ...' line into depth, multipv, score, nodes, nps, pv."""
    tokens = line.split()
    info = {}
    i = 1
    while i < len(tokens):
        t = tokens[i]
        if t == "depth" and i + 1 < len(tokens):
            try:
                info["depth"] = int(tokens[i + 1])
            except ValueError:
                pass
            i += 2
        elif t == "multipv" and i + 1 < len(tokens):
            try:
                info["multipv"] = int(tokens[i + 1])
            except ValueError:
                pass
            i += 2
        elif t == "nodes" and i + 1 < len(tokens):
            try:
                info["nodes"] = int(tokens[i + 1])
            except ValueError:
                pass
            i += 2
        elif t == "nps" and i + 1 < len(tokens):
            try:
                info["nps"] = int(tokens[i + 1])
            except ValueError:
                pass
            i += 2
        elif t == "score" and i + 2 < len(tokens):
            kind = tokens[i + 1]
            try:
                val = int(tokens[i + 2])
                if kind == "cp":
                    info["score"] = {"cp": val}
                elif kind == "mate":
                    info["score"] = {"mate": val}
            except ValueError:
                pass
            i += 3
        elif t == "pv":
            info["pv"] = tokens[i + 1 :]
            break
        else:
            i += 1
    return info


class PikafishManager:
    """Thread-safe lazy manager for a single Pikafish UCI process."""

    def __init__(self):
        self._cmd_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._proc = None
        self._stdout_q = queue.Queue()
        self._reader_thread = None
        self._cfg = None
        self._name = ""
        self._options = []
        self._option_names = set()
        self._active_search_id = None
        self._streams = {}  # search_id -> list[queue.Queue]
        self._default_threads = max(1, min(4, (os.cpu_count() or 2) - 1))

    def _load_cfg(self):
        if not ENGINE_JSON.exists():
            return None
        try:
            cfg = json.loads(ENGINE_JSON.read_text(encoding="utf-8"))
            exe, nnue = resolve_engine_paths(cfg, ROOT)
            if exe.exists() and nnue.exists():
                return cfg
        except Exception as exc:
            LOG.error("Failed to read engine.json: %s", exc)
        return None

    def _reader_loop(self, proc):
        try:
            for raw in proc.stdout:
                line = raw.strip()
                if line:
                    self._stdout_q.put(line)
        except Exception:
            pass
        finally:
            self._stdout_q.put(None)

    def _send(self, cmd: str):
        if not self._proc or self._proc.poll() is not None:
            raise RuntimeError("Engine process not running")
        self._proc.stdin.write(cmd + "\n")
        self._proc.stdin.flush()

    def _drain_until(self, prefix: str, timeout: float = 8.0):
        deadline = time.monotonic() + timeout
        lines = []
        while True:
            rem = deadline - time.monotonic()
            if rem <= 0:
                raise TimeoutError(f"Engine timed out waiting for {prefix}")
            try:
                line = self._stdout_q.get(timeout=min(0.25, rem))
            except queue.Empty:
                if self._proc and self._proc.poll() is not None:
                    raise RuntimeError("Engine process exited unexpectedly")
                continue
            if line is None:
                raise RuntimeError("Engine stdout closed")
            lines.append(line)
            if line.startswith(prefix):
                return lines

    def _ensure_started_locked(self):
        if self._proc is not None and self._proc.poll() is None:
            return True

        self._stop_proc_locked()
        cfg = self._load_cfg()
        if not cfg:
            return False

        exe_path, nnue_path = resolve_engine_paths(cfg, ROOT)
        self._stdout_q = queue.Queue()

        try:
            self._proc, meta = launch_engine(exe_path, nnue_path, capture_stderr=False)
            self._reader_thread = threading.Thread(
                target=self._reader_loop, args=(self._proc,), daemon=True
            )
            self._reader_thread.start()

            self._send("uci")
            uci_lines = self._drain_until("uciok", timeout=20.0)

            self._cfg = cfg
            self._name = cfg.get("name", "Pikafish")
            self._options = []
            for ln in uci_lines:
                if ln.startswith("id name "):
                    self._name = ln[len("id name "):].strip()
                elif ln.startswith("option name "):
                    opt = parse_uci_option(ln)
                    if opt:
                        self._options.append(opt)
            self._option_names = {o["name"] for o in self._options}

            if "EvalFile" in self._option_names and meta["eval_file"]:
                self._send(f"setoption name EvalFile value {meta['eval_file']}")
            if "Threads" in self._option_names:
                self._send(f"setoption name Threads value {self._default_threads}")
            if "Hash" in self._option_names:
                self._send("setoption name Hash value 128")

            self._send("isready")
            self._drain_until("readyok", timeout=20.0)
            LOG.info("Started %s (%s), threads=%d", self._name, cfg.get("cpu_build"), self._default_threads)
            return True
        except Exception as exc:
            LOG.error("Engine start failed: %s", exc)
            self._stop_proc_locked()
            return False

    def _stop_proc_locked(self):
        if self._proc is not None:
            proc = self._proc
            self._proc = None
            try:
                if proc.poll() is None:
                    proc.stdin.write("quit\n")
                    proc.stdin.flush()
                    proc.wait(timeout=1.5)
            except Exception:
                pass
            try:
                if proc.poll() is None:
                    proc.terminate()
                    proc.wait(timeout=1.0)
            except Exception:
                pass
            try:
                if proc.poll() is None:
                    proc.kill()
            except Exception:
                pass

    def shutdown(self):
        with self._cmd_lock:
            self._stop_proc_locked()

    def info(self):
        with self._cmd_lock:
            ok = self._ensure_started_locked()
            if not ok:
                return {
                    "available": False,
                    "name": None,
                    "version": None,
                    "cpu_build": None,
                    "options": [],
                    "error": "Pikafish not configured. Run python tools/setup_engine.py",
                }
            return {
                "available": True,
                "name": self._name,
                "version": self._cfg.get("version"),
                "cpu_build": self._cfg.get("cpu_build"),
                "default_threads": self._default_threads,
                "options": self._options,
            }

    def subscribe_stream(self, search_id: str) -> queue.Queue:
        q = queue.Queue()
        with self._state_lock:
            self._streams.setdefault(search_id, []).append(q)
        return q

    def unsubscribe_stream(self, search_id: str, q: queue.Queue):
        with self._state_lock:
            lst = self._streams.get(search_id)
            if lst and q in lst:
                lst.remove(q)
                if not lst:
                    self._streams.pop(search_id, None)

    def _broadcast_stream(self, search_id: str, payload: dict):
        with self._state_lock:
            listeners = list(self._streams.get(search_id, ()))
        for q in listeners:
            q.put(payload)

    def stop_search(self, search_id: str):
        with self._state_lock:
            if self._active_search_id == search_id and self._proc and self._proc.poll() is None:
                try:
                    self._send("stop")
                except Exception:
                    pass

    def new_game(self):
        with self._cmd_lock:
            if self._ensure_started_locked():
                self._send("ucinewgame")
                self._send("isready")
                self._drain_until("readyok", timeout=5.0)
        return {"ok": True}

    def search(self, req: dict):
        search_id = str(req.get("id", "0"))[:64]
        fen = req.get("fen", "")
        moves = req.get("moves") or []
        movetime_ms = req.get("movetime_ms")
        depth = req.get("depth")
        nodes = req.get("nodes")
        multipv = req.get("multipv", 1)
        uci_options = req.get("options") or {}

        # Strict input validation
        if not isinstance(fen, str) or "\n" in fen or "\r" in fen or not FEN_RE.match(fen.strip()):
            return 400, {"error": "Invalid FEN"}
        fen = fen.strip()

        if not isinstance(moves, list) or len(moves) > 600:
            return 400, {"error": "Invalid moves list"}
        clean_moves = []
        for mv in moves:
            if not isinstance(mv, str) or not MOVE_RE.match(mv):
                return 400, {"error": f"Invalid move coordinate: {mv!r}"}
            clean_moves.append(mv)

        try:
            multipv = max(1, min(8, int(multipv)))
        except (TypeError, ValueError):
            return 400, {"error": "Invalid multipv"}

        go_parts = ["go"]
        if depth is not None:
            try:
                d_val = max(1, min(40, int(depth)))
            except (TypeError, ValueError):
                return 400, {"error": "Invalid depth"}
            go_parts.extend(["depth", str(d_val)])
        if movetime_ms is not None:
            try:
                t_val = max(20, min(30000, int(movetime_ms)))
            except (TypeError, ValueError):
                return 400, {"error": "Invalid movetime_ms"}
            go_parts.extend(["movetime", str(t_val)])
        if nodes is not None:
            try:
                n_val = max(1000, min(2_000_000_000, int(nodes)))
            except (TypeError, ValueError):
                return 400, {"error": "Invalid nodes"}
            go_parts.extend(["nodes", str(n_val)])
        if len(go_parts) == 1:
            go_parts.extend(["movetime", "1000"])

        with self._cmd_lock:
            if not self._ensure_started_locked():
                return 503, {"error": "Engine unavailable"}

            t0 = time.monotonic()
            with self._state_lock:
                self._active_search_id = search_id

            try:
                # Apply MultiPV & any validated optional UCI options reported by engine
                if "MultiPV" in self._option_names:
                    self._send(f"setoption name MultiPV value {multipv}")
                if isinstance(uci_options, dict):
                    for k, v in uci_options.items():
                        if k in self._option_names and k not in ("EvalFile", "Hash"):
                            sval = str(v).strip()
                            if "\n" not in sval and "\r" not in sval and len(sval) <= 32:
                                self._send(f"setoption name {k} value {sval}")

                pos_cmd = f"position fen {fen}"
                if clean_moves:
                    pos_cmd += " moves " + " ".join(clean_moves)
                self._send(pos_cmd)
                self._send("isready")
                self._drain_until("readyok", timeout=5.0)
                self._send(" ".join(go_parts))

                # Read info lines until bestmove
                timeout_sec = 35.0
                if movetime_ms is not None:
                    timeout_sec = max(5.0, min(35.0, (int(movetime_ms) / 1000.0) + 5.0))
                deadline = time.monotonic() + timeout_sec

                lines_by_pv = {}
                last_info = {"depth": 0, "score": {"cp": 0}, "nodes": 0, "nps": 0, "pv": []}
                bestmove = None
                ponder = None

                while True:
                    rem = deadline - time.monotonic()
                    if rem <= 0:
                        self._send("stop")
                        deadline = time.monotonic() + 2.0
                        continue
                    try:
                        line = self._stdout_q.get(timeout=min(0.25, rem))
                    except queue.Empty:
                        if self._proc and self._proc.poll() is not None:
                            raise RuntimeError("Engine crashed during search")
                        continue
                    if line is None:
                        raise RuntimeError("Engine stdout closed during search")

                    if line.startswith("info "):
                        parsed = parse_info_line(line)
                        if "depth" in parsed and "score" in parsed and "pv" in parsed:
                            pv_idx = parsed.get("multipv", 1)
                            lines_by_pv[pv_idx] = {
                                "move": parsed["pv"][0],
                                "score": parsed["score"],
                                "depth": parsed["depth"],
                                "pv": parsed["pv"],
                            }
                            if pv_idx == 1:
                                last_info = {
                                    "depth": parsed["depth"],
                                    "score": parsed["score"],
                                    "nodes": parsed.get("nodes", last_info["nodes"]),
                                    "nps": parsed.get("nps", last_info["nps"]),
                                    "pv": parsed["pv"],
                                }
                                self._broadcast_stream(search_id, {"type": "info", "id": search_id, **last_info})
                    elif line.startswith("bestmove "):
                        parts = line.split()
                        if len(parts) >= 2 and parts[1] != "(none)":
                            bestmove = parts[1]
                        if len(parts) >= 4 and parts[2] == "ponder":
                            ponder = parts[3]
                        break

                elapsed_ms = int((time.monotonic() - t0) * 1000)
                ordered_lines = [lines_by_pv[k] for k in sorted(lines_by_pv.keys())]
                result = {
                    "id": search_id,
                    "bestmove": bestmove,
                    "ponder": ponder,
                    "score": last_info["score"],
                    "depth": last_info["depth"],
                    "nodes": last_info["nodes"],
                    "nps": last_info["nps"],
                    "pv": last_info["pv"],
                    "elapsed_ms": elapsed_ms,
                }
                if multipv > 1:
                    result["lines"] = ordered_lines
                return 200, result
            except Exception as exc:
                LOG.error("Search failed (%s), restarting engine", exc)
                self._stop_proc_locked()
                return 500, {"error": "Engine search failed"}
            finally:
                with self._state_lock:
                    if self._active_search_id == search_id:
                        self._active_search_id = None
                self._broadcast_stream(search_id, {"type": "done", "id": search_id})


ENGINE = PikafishManager()


class BridgeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        LOG.info("%s - %s", self.address_string(), format % args)

    def _check_host(self) -> bool:
        host_hdr = (self.headers.get("Host") or "").strip().lower()
        host_only = host_hdr.split(":")[0]
        if host_only not in ALLOWED_HOSTS:
            self._send_json(403, {"error": "Forbidden host"})
            return False
        return True

    def _send_json(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, (400, {"error": "Invalid Content-Length"})
        if length < 0 or length > MAX_BODY_BYTES:
            return None, (400, {"error": "Request body too large"})
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            return None, (400, {"error": "Malformed JSON"})
        if not isinstance(obj, dict):
            return None, (400, {"error": "JSON body must be an object"})
        return obj, None

    def do_GET(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/engine/info":
            self._send_json(200, ENGINE.info())
            return
        if parsed.path == "/api/engine/stream":
            qs = urllib.parse.parse_qs(parsed.query)
            sid = (qs.get("id") or ["0"])[0][:64]
            self._handle_sse(sid)
            return
        super().do_GET()

    def do_POST(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/engine/search":
            body, err = self._read_json_body()
            if err:
                self._send_json(*err)
                return
            code, res = ENGINE.search(body)
            self._send_json(code, res)
            return
        if parsed.path == "/api/engine/stop":
            body, err = self._read_json_body()
            if err:
                self._send_json(*err)
                return
            ENGINE.stop_search(str(body.get("id", "0"))[:64])
            self._send_json(200, {"ok": True})
            return
        if parsed.path == "/api/engine/newgame":
            self._send_json(200, ENGINE.new_game())
            return
        self._send_json(404, {"error": "Not found"})

    def _handle_sse(self, search_id: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = ENGINE.subscribe_stream(search_id)
        try:
            deadline = time.monotonic() + 35.0
            while time.monotonic() < deadline:
                try:
                    msg = q.get(timeout=0.5)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                payload = f"data: {json.dumps(msg, ensure_ascii=False)}\n\n".encode("utf-8")
                self.wfile.write(payload)
                self.wfile.flush()
                if msg.get("type") == "done":
                    break
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            ENGINE.unsubscribe_stream(search_id, q)


def create_server(port: int = 8000):
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), BridgeHandler)


def main():
    parser = argparse.ArgumentParser(description="Chinese Chess local server + Pikafish UCI bridge")
    parser.add_argument("--port", type=int, default=8000, help="Port on 127.0.0.1 (default: 8000)")
    args = parser.parse_args()

    atexit.register(ENGINE.shutdown)

    def _handle_sig(_signum, _frame):
        ENGINE.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_sig)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_sig)

    server = create_server(args.port)
    print(f"Chinese Chess server running at http://127.0.0.1:{args.port}")
    LOG.info("Server listening on 127.0.0.1:%d", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        ENGINE.shutdown()


if __name__ == "__main__":
    main()
