"""
Shared Pikafish engine launcher and prober used by both tools/setup_engine.py
and tools/server.py so their launch parameters can never diverge.

Handles:
- Identical subprocess launch (cwd=exe.parent, UTF-8 pipes, relative EvalFile,
  env copy, CREATE_NO_WINDOW on Windows).
- Non-ASCII path fallbacks on Windows:
    1. Direct launch (cwd=exe.parent + relative EvalFile + UTF-8 pipes)
    2. Windows 8.3 short path via GetShortPathNameW (ctypes)
    3. ASCII-only copy under %LOCALAPPDATA%\\ChineseChessEngine\\
- Threaded stdout/stderr readers, 20 s first-run timeout, step-by-step
  uci -> uciok -> EvalFile -> isready -> readyok handshake.
- Diagnostics for antivirus quarantine (missing / 0-byte exe), missing
  Visual C++ Redistributable (0xC0000135), and unsupported CPU ISA (0xC000001D).
"""
from __future__ import annotations

import ctypes
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

VC_REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
STATUS_DLL_NOT_FOUND = (-1073741515, 0xC0000135)
STATUS_ILLEGAL_INSTRUCTION = (-1073741795, 0xC000001D)

_WIN_JOB_HANDLE = None


def _ensure_kill_on_close_job():
    """Create a Windows Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so child engines never orphan."""
    global _WIN_JOB_HANDLE
    if sys.platform != "win32":
        return None
    if _WIN_JOB_HANDLE is not None:
        return _WIN_JOB_HANDLE
    try:
        import ctypes.wintypes as wt

        kernel32 = ctypes.windll.kernel32
        kernel32.CreateJobObjectW.restype = wt.HANDLE
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wt.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wt.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wt.DWORD),
                ("SchedulingClass", wt.DWORD),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
            )]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        kernel32.SetInformationJobObject.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
        kernel32.SetInformationJobObject.restype = wt.BOOL
        ok = kernel32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
        if ok:
            _WIN_JOB_HANDLE = job
            return job
    except Exception:
        return None
    return None


def _assign_to_job(proc: subprocess.Popen):
    if sys.platform != "win32":
        return
    job = _ensure_kill_on_close_job()
    if not job:
        return
    try:
        import ctypes.wintypes as wt
        kernel32 = ctypes.windll.kernel32
        kernel32.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
        kernel32.AssignProcessToJobObject.restype = wt.BOOL
        kernel32.AssignProcessToJobObject(job, wt.HANDLE(int(proc._handle)))
    except Exception:
        pass


def is_ascii(text: str) -> bool:
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def get_short_path(path: Path) -> Path | None:
    """Return the Windows 8.3 short path for an existing path, or None if unavailable."""
    if sys.platform != "win32":
        return None
    full = str(path.resolve())
    try:
        kernel32 = ctypes.windll.kernel32
        get_short = kernel32.GetShortPathNameW
        get_short.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
        get_short.restype = ctypes.c_uint
        buf_len = get_short(full, None, 0)
        if buf_len == 0:
            return None
        buf = ctypes.create_unicode_buffer(buf_len)
        res = get_short(full, buf, buf_len)
        if res == 0:
            return None
        short = Path(buf.value)
        if short.exists():
            return short
    except Exception:
        return None
    return None


def default_ascii_engine_dir() -> Path:
    """Return an ASCII-only directory suitable for running the engine on Windows."""
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app and is_ascii(local_app):
        return Path(local_app) / "ChineseChessEngine"
    tmp = tempfile.gettempdir()
    if is_ascii(tmp):
        return Path(tmp) / "ChineseChessEngine"
    return Path("C:/ChineseChessEngine")


def copy_to_ascii_dir(
    exe_path: Path,
    nnue_path: Path | None,
    target_dir: Path | None = None,
) -> tuple[Path, Path | None]:
    """Copy exe (and optional nnue) into an ASCII-only directory if not already identical."""
    dest_dir = target_dir or default_ascii_engine_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_exe = dest_dir / exe_path.name
    if not dest_exe.exists() or dest_exe.stat().st_size != exe_path.stat().st_size:
        shutil.copy2(exe_path, dest_exe)

    dest_nnue = None
    if nnue_path is not None and nnue_path.exists():
        dest_nnue = dest_dir / nnue_path.name
        if not dest_nnue.exists() or dest_nnue.stat().st_size != nnue_path.stat().st_size:
            shutil.copy2(nnue_path, dest_nnue)

    return dest_exe, dest_nnue


def resolve_engine_paths(cfg: dict, root: Path) -> tuple[Path, Path]:
    """Resolve exe and nnue paths from engine/engine.json (relative to root or absolute)."""
    raw_exe = Path(cfg["exe"])
    raw_nnue = Path(cfg["nnue"])
    exe_path = raw_exe if raw_exe.is_absolute() else (root / raw_exe)
    nnue_path = raw_nnue if raw_nnue.is_absolute() else (root / raw_nnue)
    return exe_path, nnue_path


def compute_eval_file_arg(exe_path: Path, nnue_path: Path | None) -> str | None:
    """Return relative filename when nnue sits beside exe (avoids Windows ANSI path bugs)."""
    if nnue_path is None:
        return None
    try:
        if nnue_path.parent.resolve() == exe_path.parent.resolve():
            return nnue_path.name
    except Exception:
        if nnue_path.parent == exe_path.parent:
            return nnue_path.name
    return str(nnue_path)


def antivirus_quarantine_hint(target_dir: Path) -> str:
    return (
        f"Executable is missing or 0 bytes ({target_dir}); the file may have been quarantined by Windows Security.\n"
        f"To fix: open Windows Security -> Virus & threat protection -> Manage settings -> "
        f"Add or remove exclusions -> Add an exclusion -> Folder -> select:\n"
        f"  {target_dir}\n"
        f"Then re-run: python tools/setup_engine.py"
    )


def launch_engine(
    exe_path: Path,
    nnue_path: Path | None = None,
    *,
    capture_stderr: bool = False,
) -> tuple[subprocess.Popen, dict]:
    """
    Launch Pikafish with identical parameters for setup_engine.py and server.py.
    Returns (proc, meta) where meta describes cmd, cwd, and eval_file.
    """
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    cmd = [str(exe_path)]
    cwd = str(exe_path.parent)
    env = os.environ.copy()
    eval_file = compute_eval_file_arg(exe_path, nnue_path)

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE if capture_stderr else subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        cwd=cwd,
        env=env,
        creationflags=creationflags,
    )
    _assign_to_job(proc)
    meta = {
        "cmd": cmd,
        "cwd": cwd,
        "eval_file": eval_file,
    }
    return proc, meta


def _stop_proc(proc: subprocess.Popen | None):
    if proc is None:
        return
    try:
        if proc.poll() is None and proc.stdin:
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


def _explain_exit_code(returncode: int | None, stdout_lines: list[str], stderr_lines: list[str], default_reason: str) -> str:
    if returncode in STATUS_DLL_NOT_FOUND:
        return (
            f"Exit code 0xC0000135 ({returncode}): Visual C++ Redistributable (x64) is missing. "
            f"Install it from {VC_REDIST_URL} and re-run setup."
        )
    if returncode in STATUS_ILLEGAL_INSTRUCTION:
        return (
            f"Exit code 0xC000001D ({returncode}): CPU does not support an instruction required by this binary."
        )
    joined = "\n".join(stdout_lines + stderr_lines).lower()
    if "network" in joined and ("not found" in joined or "unable" in joined or "error" in joined):
        return f"Engine could not load NNUE network file ({default_reason})."
    return default_reason


def probe_engine(
    exe_path: Path,
    nnue_path: Path | None = None,
    *,
    timeout: float = 20.0,
    strategy: str = "direct",
) -> dict:
    """
    Probe a Pikafish binary using threaded stdout/stderr readers:
      1. Send 'uci', wait for 'uciok' (up to timeout s)
      2. If EvalFile option exists and nnue_path is set, send 'setoption name EvalFile value <eval_file>'
      3. Send 'isready', wait for 'readyok' (up to timeout s)
      4. Send 'quit' and collect exit code.
    """
    result = {
        "ok": False,
        "name": "",
        "options": [],
        "returncode": None,
        "stdout_lines": [],
        "stderr_lines": [],
        "cmd": [str(exe_path)],
        "cwd": str(exe_path.parent),
        "eval_file": compute_eval_file_arg(exe_path, nnue_path),
        "reason": "",
        "exe_path": str(exe_path),
        "nnue_path": str(nnue_path) if nnue_path else None,
        "strategy": strategy,
    }

    if not exe_path.exists() or exe_path.stat().st_size == 0:
        result["reason"] = antivirus_quarantine_hint(exe_path.parent)
        return result

    if nnue_path is not None and (not nnue_path.exists() or nnue_path.stat().st_size < 1_000_000):
        result["reason"] = f"NNUE file missing or incomplete: {nnue_path}"
        return result

    proc = None
    out_q: queue.Queue[str | None] = queue.Queue()
    stderr_lines: list[str] = []
    stdout_lines: list[str] = []

    def _read_stdout(stream):
        try:
            for raw in stream:
                out_q.put(raw.rstrip("\r\n"))
        except Exception as exc:
            stderr_lines.append(f"[stdout reader error] {exc}")
        finally:
            out_q.put(None)

    def _read_stderr(stream):
        try:
            for raw in stream:
                line = raw.rstrip("\r\n")
                if line:
                    stderr_lines.append(line)
        except Exception:
            pass

    def _wait_for(token: str, wait_s: float) -> tuple[bool, str]:
        deadline = time.monotonic() + wait_s
        while True:
            rem = deadline - time.monotonic()
            if rem <= 0:
                return False, f"Timed out after {wait_s:.1f}s waiting for '{token}'"
            try:
                line = out_q.get(timeout=min(0.2, rem))
            except queue.Empty:
                if proc is not None and proc.poll() is not None:
                    return False, f"Engine exited prematurely (code {proc.returncode}) before '{token}'"
                continue
            if line is None:
                rc = proc.poll() if proc else None
                return False, f"Engine stdout closed (code {rc}) before '{token}'"
            stdout_lines.append(line)
            if line.strip() == token or line.strip().startswith(token + " "):
                return True, ""

    try:
        proc, meta = launch_engine(exe_path, nnue_path, capture_stderr=True)
        result["cmd"] = meta["cmd"]
        result["cwd"] = meta["cwd"]
        result["eval_file"] = meta["eval_file"]

        t_out = threading.Thread(target=_read_stdout, args=(proc.stdout,), daemon=True)
        t_err = threading.Thread(target=_read_stderr, args=(proc.stderr,), daemon=True)
        t_out.start()
        t_err.start()

        # Step 1: uci -> uciok
        proc.stdin.write("uci\n")
        proc.stdin.flush()
        ok_uci, err_uci = _wait_for("uciok", timeout)
        if not ok_uci:
            _stop_proc(proc)
            t_err.join(timeout=0.5)
            result["returncode"] = proc.returncode
            result["stdout_lines"] = stdout_lines
            result["stderr_lines"] = stderr_lines
            result["reason"] = _explain_exit_code(proc.returncode, stdout_lines, stderr_lines, err_uci)
            return result

        eng_name = "Pikafish"
        has_eval_file = False
        options = []
        for ln in stdout_lines:
            if ln.startswith("id name "):
                eng_name = ln[len("id name "):].strip()
            elif ln.startswith("option name "):
                options.append(ln)
                if ln.startswith("option name EvalFile "):
                    has_eval_file = True

        # Step 2: EvalFile (relative when beside exe) + isready -> readyok
        if has_eval_file and meta["eval_file"]:
            proc.stdin.write(f"setoption name EvalFile value {meta['eval_file']}\n")
        proc.stdin.write("isready\n")
        proc.stdin.flush()

        ok_ready, err_ready = _wait_for("readyok", timeout)
        if not ok_ready:
            _stop_proc(proc)
            t_err.join(timeout=0.5)
            result["returncode"] = proc.returncode
            result["stdout_lines"] = stdout_lines
            result["stderr_lines"] = stderr_lines
            result["reason"] = _explain_exit_code(proc.returncode, stdout_lines, stderr_lines, err_ready)
            return result

        # Step 3: clean quit
        _stop_proc(proc)
        t_out.join(timeout=0.5)
        t_err.join(timeout=0.5)

        result["returncode"] = proc.returncode
        result["stdout_lines"] = stdout_lines
        result["stderr_lines"] = stderr_lines

        err_lower = "\n".join(stderr_lines).lower()
        out_lower = "\n".join(stdout_lines).lower()
        if "error" in err_lower or "failed" in err_lower or "not found" in out_lower:
            result["reason"] = _explain_exit_code(
                proc.returncode,
                stdout_lines,
                stderr_lines,
                "Engine reported an error while loading network or initializing.",
            )
            return result

        result["ok"] = True
        result["name"] = eng_name
        result["options"] = options
        result["reason"] = "ok"
        return result
    except OSError as exc:
        result["reason"] = f"OS error launching binary: {exc}"
        return result
    except Exception as exc:
        result["reason"] = f"Unexpected probe error: {type(exc).__name__}: {exc}"
        return result
    finally:
        _stop_proc(proc)


def probe_with_fallbacks(
    exe_path: Path,
    nnue_path: Path | None = None,
    *,
    timeout: float = 20.0,
    ascii_copy_dir: Path | None = None,
) -> tuple[dict, list[dict]]:
    """
    Try probing exe_path directly; if it fails and the directory contains non-ASCII
    characters, automatically try:
      (a) Windows 8.3 short path (GetShortPathNameW)
      (b) Copying exe + nnue to an ASCII-only folder (%LOCALAPPDATA%\\ChineseChessEngine\\)
    Returns (final_result, all_attempts).
    """
    attempts: list[dict] = []

    res = probe_engine(exe_path, nnue_path, timeout=timeout, strategy="direct")
    attempts.append(res)
    if res["ok"]:
        return res, attempts

    # If the directory is non-ASCII, try Windows 8.3 short path then ASCII copy
    dir_str = str(exe_path.parent.resolve())
    if not is_ascii(dir_str):
        if sys.platform == "win32":
            short_exe = get_short_path(exe_path)
            short_nnue = get_short_path(nnue_path) if nnue_path else None
            if short_exe and str(short_exe) != str(exe_path):
                res_short = probe_engine(short_exe, short_nnue, timeout=timeout, strategy="short_path")
                attempts.append(res_short)
                if res_short["ok"]:
                    return res_short, attempts

        try:
            copied_exe, copied_nnue = copy_to_ascii_dir(exe_path, nnue_path, target_dir=ascii_copy_dir)
            res_copy = probe_engine(copied_exe, copied_nnue, timeout=timeout, strategy="ascii_copy")
            attempts.append(res_copy)
            if res_copy["ok"]:
                return res_copy, attempts
        except Exception as exc:
            attempts.append({
                "ok": False,
                "name": "",
                "options": [],
                "returncode": None,
                "stdout_lines": [],
                "stderr_lines": [],
                "cmd": [],
                "cwd": str(ascii_copy_dir or default_ascii_engine_dir()),
                "eval_file": nnue_path.name if nnue_path else None,
                "reason": f"ASCII fallback copy failed: {exc}",
                "exe_path": str(exe_path),
                "nnue_path": str(nnue_path) if nnue_path else None,
                "strategy": "ascii_copy",
            })

    return attempts[-1], attempts


def format_probe_failure(attempt: dict) -> str:
    """Format a human-readable failure report (exit code, cmd, cwd, first 20 stdout/stderr lines)."""
    lines = [
        f"  strategy : {attempt.get('strategy')}",
        f"  cmd      : {attempt.get('cmd')}",
        f"  cwd      : {attempt.get('cwd')}",
        f"  eval_file: {attempt.get('eval_file')}",
        f"  exit_code: {attempt.get('returncode')}",
        f"  reason   : {attempt.get('reason')}",
    ]
    out_head = (attempt.get("stdout_lines") or [])[:20]
    err_head = (attempt.get("stderr_lines") or [])[:20]
    lines.append(f"  stdout (first {len(out_head)} lines):")
    if out_head:
        lines.extend(f"    | {ln}" for ln in out_head)
    else:
        lines.append("    | <empty>")
    lines.append(f"  stderr (first {len(err_head)} lines):")
    if err_head:
        lines.extend(f"    | {ln}" for ln in err_head)
    else:
        lines.append("    | <empty>")
    return "\n".join(lines)
