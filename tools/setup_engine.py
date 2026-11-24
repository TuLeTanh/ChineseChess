"""
Idempotent setup script for Pikafish (official UCI Xiangqi engine, GPL v3).
1. If engine/engine.json already points to a working engine, verifies and keeps it.
2. Queries https://api.github.com/repos/official-pikafish/Pikafish/releases/latest
   (falling back to cached local archive / extracted files if offline).
3. Downloads the release archive (.7z or .zip) into engine/ and extracts it.
4. Locates pikafish.nnue and all Windows .exe binaries in the archive.
5. Probes each binary fastest-ISA first using the shared tools/engine_launch.py helper
   (same launch method as tools/server.py, 20 s first-run timeout, non-ASCII fallbacks:
   direct -> Windows 8.3 short path -> %LOCALAPPDATA%\\ChineseChessEngine\\).
6. Writes engine/engine.json, logs/setup_engine.log, copies GPL v3 LICENSE,
   and creates Vietnamese engine/README.md.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from engine_launch import (  # noqa: E402
    antivirus_quarantine_hint,
    format_probe_failure,
    probe_engine,
    probe_with_fallbacks,
    resolve_engine_paths,
)

ROOT = TOOLS_DIR.parent
ENGINE_DIR = ROOT / "engine"
ENGINE_JSON = ENGINE_DIR / "engine.json"
LOG_DIR = ROOT / "logs"
SETUP_LOG = LOG_DIR / "setup_engine.log"
RELEASE_API = "https://api.github.com/repos/official-pikafish/Pikafish/releases/latest"
LICENSE_URL = "https://raw.githubusercontent.com/official-pikafish/Pikafish/master/Copying.txt"

ISA_PRIORITY = [
    "vnni512",
    "avx512",
    "vnni256",
    "bmi2",
    "avx2",
    "sse41-popcnt",
    "ssse3",
    "sse2",
    "universal",
    "x86-64",
]


def log_line(msg: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(SETUP_LOG, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {msg}\n")


def isa_rank(path: Path) -> int:
    name = path.name.lower()
    for idx, key in enumerate(ISA_PRIORITY):
        if key in name:
            return idx
    return len(ISA_PRIORITY)


def download_file(url: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ChineseChess-Setup/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def find_7z() -> str | None:
    seven_z = shutil.which("7z")
    if seven_z:
        return seven_z
    for cand in [
        r"C:\Users\ADMIN\scoop\shims\7z.exe",
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]:
        if os.path.exists(cand):
            return cand
    return None


def extract_archive(archive_path: Path, out_dir: Path):
    if archive_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(out_dir)
        return

    seven_z = find_7z()
    if not seven_z:
        raise RuntimeError("7z executable not found to extract .7z archive.")
    subprocess.run(
        [seven_z, "x", "-y", f"-o{out_dir}", str(archive_path)],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def list_archive_entries(archive_path: Path) -> list[str]:
    if not archive_path or not archive_path.exists():
        return []
    try:
        if archive_path.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive_path, "r") as zf:
                return zf.namelist()
        seven_z = find_7z()
        if not seven_z:
            return []
        proc = subprocess.run(
            [seven_z, "l", "-slt", str(archive_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        entries = []
        for line in (proc.stdout or "").splitlines():
            if line.startswith("Path = "):
                val = line[len("Path = "):].strip()
                if val and val != str(archive_path):
                    entries.append(val)
        return entries
    except Exception:
        return []


def format_stored_path(path: Path) -> str:
    """Store project-relative POSIX path if inside ROOT, otherwise absolute path."""
    try:
        rel = path.resolve().relative_to(ROOT.resolve())
        return str(rel).replace("\\", "/")
    except ValueError:
        return str(path.resolve())


def write_engine_readme(version: str, exe_stored: str, nnue_stored: str, cpu_build: str):
    readme = f"""# Pikafish Engine (`engine/`)

Thư mục này chứa tệp thực thi **Pikafish** (`{version}`, bản CPU `{cpu_build}`) và mạng nơ-ron NNUE (`{nnue_stored}`) dùng cho chế độ **Đấu máy** qua cầu nối cục bộ `tools/server.py`.

## Nguồn tải
- Phát hành chính thức: [official-pikafish/Pikafish Releases](https://github.com/official-pikafish/Pikafish/releases)
- Cài đặt / cập nhật tự động:
  ```powershell
  python tools/setup_engine.py
  ```

## Tóm tắt bản quyền (GPL v3 & NNUE)
- **Mã nguồn & tệp thực thi Pikafish**: phát hành theo **GNU General Public License v3.0 (GPL v3)** (xem [LICENSE](LICENSE)). Nếu phân phối trò chơi kèm tệp thực thi Pikafish, bạn bắt buộc phải đi kèm bản sao giấy phép GPL v3 và mã nguồn (hoặc đường dẫn tới mã nguồn tương ứng).
- **Mạng nơ-ron `pikafish.nnue`**: tuân theo điều khoản riêng của dự án Pikafish — **không sử dụng cho mục đích thương mại khi chưa có sự cho phép**.
- Các tệp nhị phân (`*.exe`, `*.nnue`, `*.zip`, `*.7z`) đã được đưa vào `.gitignore` và không commit vào kho mã nguồn.

## Cấu hình hiện tại (`engine/engine.json`)
- Tệp thực thi: `{exe_stored}`
- Mạng NNUE: `{nnue_stored}`
"""
    (ENGINE_DIR / "README.md").write_text(readme, encoding="utf-8")


def verify_existing_config() -> bool:
    """If engine/engine.json already points to a working engine, verify and keep it."""
    if not ENGINE_JSON.exists():
        return False
    try:
        cfg = json.loads(ENGINE_JSON.read_text(encoding="utf-8"))
        exe_path, nnue_path = resolve_engine_paths(cfg, ROOT)
    except Exception as exc:
        log_line(f"Existing engine.json unreadable ({exc}); proceeding with setup.")
        return False

    if not exe_path.exists() or exe_path.stat().st_size == 0 or not nnue_path.exists():
        log_line(f"Existing engine.json paths missing (exe={exe_path}, nnue={nnue_path}); proceeding with setup.")
        return False

    res = probe_engine(exe_path, nnue_path, timeout=20.0, strategy=cfg.get("launch_strategy", "direct"))
    if res["ok"]:
        msg = f"[setup] Existing engine verified: {res['name']} ({cfg['exe']}) -> keeping engine/engine.json"
        print(msg)
        log_line(msg)
        return True

    log_line(f"Existing engine.json failed probe:\n{format_probe_failure(res)}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Idempotent Pikafish setup")
    parser.add_argument("--force", action="store_true", help="Re-probe and regenerate engine/engine.json even if valid")
    parser.add_argument("--reextract", action="store_true", help="Force re-extraction of the archive into engine/dist")
    args = parser.parse_args()

    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    extract_dir = ENGINE_DIR / "dist"
    log_line("=== setup_engine.py start ===")

    # 0. Safe idempotency: keep already-working engine/engine.json
    if not args.force and verify_existing_config():
        return

    # 1. Fetch latest release metadata (with offline fallback to cached archive / dist)
    tag = "local-cached"
    archive_path: Path | None = None
    try:
        req = urllib.request.Request(RELEASE_API, headers={"User-Agent": "ChineseChess-Setup/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            rel = json.loads(resp.read().decode("utf-8"))
        tag = rel.get("tag_name", "unknown")
        assets = rel.get("assets", [])
        chosen_asset = None
        for a in assets:
            n = a["name"].lower()
            if n.endswith(".7z") or (n.endswith(".zip") and ("win" in n or "pikafish" in n)):
                chosen_asset = a
                break
        if not chosen_asset:
            print("No suitable release archive found in latest Pikafish release.")
            log_line("ERROR: No suitable release archive in latest release.")
            sys.exit(1)

        archive_path = ENGINE_DIR / chosen_asset["name"]
        if not archive_path.exists() or archive_path.stat().st_size != chosen_asset["size"]:
            print(f"[setup] Downloading {chosen_asset['name']} ({chosen_asset['size'] / 1e6:.1f} MB)...")
            log_line(f"Downloading {chosen_asset['name']} from {chosen_asset['browser_download_url']}")
            download_file(chosen_asset["browser_download_url"], archive_path)
        else:
            print(f"[setup] Using cached {archive_path.name}")
            log_line(f"Using cached {archive_path.name}")
    except Exception as exc:
        cached = sorted(
            list(ENGINE_DIR.glob("Pikafish*.7z")) + list(ENGINE_DIR.glob("Pikafish*.zip")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if cached:
            archive_path = cached[0]
            tag = archive_path.stem.replace(".", "-")
            print(f"[setup] Offline/GitHub unreachable ({exc}); using cached {archive_path.name}")
            log_line(f"GitHub unreachable ({exc}); using cached {archive_path.name}")
        elif extract_dir.exists() and any(extract_dir.rglob("*.exe")):
            print(f"[setup] Offline/GitHub unreachable ({exc}); using existing {extract_dir}")
            log_line(f"GitHub unreachable ({exc}); using existing {extract_dir}")
        else:
            print(f"Cannot reach GitHub API ({exc}) and no cached archive found.")
            print("Manual setup: download the latest Pikafish Windows release from")
            print("  https://github.com/official-pikafish/Pikafish/releases")
            print(f"and extract pikafish-*.exe + pikafish.nnue into {extract_dir}")
            log_line(f"ERROR: Cannot reach GitHub API ({exc}) and no cached archive.")
            sys.exit(1)

    needs_extract = args.reextract or not extract_dir.exists() or not any(extract_dir.rglob("*.exe")) or not any(extract_dir.rglob("*.nnue"))
    if archive_path is not None and needs_extract:
        print(f"[setup] Extracting to {extract_dir}...")
        log_line(f"Extracting {archive_path.name} to {extract_dir}")
        extract_dir.mkdir(parents=True, exist_ok=True)
        extract_archive(archive_path, extract_dir)

    # 2. Locate pikafish.nnue
    nnue_files = sorted(extract_dir.rglob("*.nnue"), key=lambda p: p.stat().st_size, reverse=True)
    nnue_path = nnue_files[0] if nnue_files else None
    if not nnue_path or nnue_path.stat().st_size < 1_000_000:
        msg = f"ERROR: pikafish.nnue not found or too small in {extract_dir}."
        print(msg)
        log_line(msg)
        sys.exit(1)
    print(f"[setup] Found NNUE: {nnue_path.relative_to(ENGINE_DIR)} ({nnue_path.stat().st_size / 1e6:.1f} MB)")

    # 3. Locate Windows binaries and detect antivirus quarantine
    exe_files = [
        p for p in extract_dir.rglob("*.exe")
        if "windows" in str(p).lower() or "pikafish" in p.name.lower()
    ]
    exe_files.sort(key=isa_rank)
    if not exe_files or all(p.stat().st_size == 0 for p in exe_files):
        hint = antivirus_quarantine_hint(extract_dir)
        print("ERROR: No valid Windows .exe binaries found after extraction.")
        print(hint)
        log_line("ERROR: No valid .exe after extraction.\n" + hint)
        sys.exit(1)

    # 4. Probe each binary fastest-first using shared engine_launch helper (20 s timeout + non-ASCII fallbacks)
    selected_res = None
    all_failure_reports: list[str] = []
    for exe in exe_files:
        res, attempts = probe_with_fallbacks(exe, nnue_path, timeout=20.0)
        if res["ok"]:
            strat = res.get("strategy", "direct")
            print(f"  probe {exe.name}: OK ({res['name']}, strategy={strat})")
            log_line(f"probe {exe.name}: OK ({res['name']}, strategy={strat}, exe={res['exe_path']})")
            selected_res = res
            break
        else:
            print(f"  probe {exe.name}: FAILED ({res.get('reason')})")
            for att in attempts:
                rep = format_probe_failure(att)
                print(rep)
                all_failure_reports.append(f"Binary: {exe.name}\n{rep}")
                log_line(f"probe {exe.name} attempt failed:\n{rep}")

    if not selected_res:
        print("\nERROR: No Pikafish binary succeeded on this CPU.")
        if archive_path and archive_path.exists():
            entries = list_archive_entries(archive_path)
            if entries:
                print(f"Archive ({archive_path.name}) contains:")
                for e in entries:
                    print(f"  - {e}")
                log_line("Archive contents: " + ", ".join(entries))
        print(f"Full diagnostics written to: {SETUP_LOG}")
        sys.exit(1)

    # 5. Copy GPL v3 license
    license_dest = ENGINE_DIR / "LICENSE"
    extracted_licenses = list(extract_dir.rglob("Copying.txt")) + list(extract_dir.rglob("LICENSE*"))
    if extracted_licenses:
        shutil.copyfile(extracted_licenses[0], license_dest)
    elif not license_dest.exists():
        try:
            download_file(LICENSE_URL, license_dest)
        except Exception:
            pass

    final_exe = Path(selected_res["exe_path"])
    final_nnue = Path(selected_res["nnue_path"]) if selected_res.get("nnue_path") else nnue_path
    exe_stored = format_stored_path(final_exe)
    nnue_stored = format_stored_path(final_nnue)
    cpu_build = final_exe.stem

    cfg = {
        "name": selected_res["name"],
        "version": tag,
        "exe": exe_stored,
        "nnue": nnue_stored,
        "nnue_size_bytes": final_nnue.stat().st_size,
        "cpu_build": cpu_build,
        "launch_strategy": selected_res.get("strategy", "direct"),
    }
    ENGINE_JSON.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    write_engine_readme(tag, exe_stored, nnue_stored, cpu_build)
    done_msg = f"[setup] Ready! Selected {cpu_build} ({cfg['launch_strategy']}) -> engine/engine.json"
    print(done_msg)
    log_line(done_msg)


if __name__ == "__main__":
    main()
