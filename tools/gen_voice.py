"""
Generate decisive Chinese "ancient general" voice lines using edge-tts.
Supports per-event voice overrides via --voice-map, e.g.:
  --voice-map "check=zh-CN-YunyangNeural:-20Hz:+5%,capture=zh-CN-YunyangNeural:-20Hz:+5%"

Defaults:
  - Global default: zh-CN-YunjianNeural, pitch -40Hz, rate +15%, volume +20%
  - check & capture: zh-CN-YunyangNeural, pitch -20Hz, rate +5%, volume +20%

Audition3 (preview/voices/audition3/):
  Generates "将军！", "吃！", "杀！" with zh-CN-YunyangNeural at -20Hz and
  rates {-10%, 0%, +5%, +10%} (volume +20%).
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
import edge_tts

DEFAULT_VOICE = "zh-CN-YunjianNeural"
DEFAULT_PITCH = "-40Hz"
DEFAULT_RATE = "+15%"
DEFAULT_VOLUME = "+20%"

DEFAULT_VOICE_MAP = {
    "check": ("zh-CN-YunyangNeural", "-20Hz", "+5%"),
    "capture": ("zh-CN-YunyangNeural", "-20Hz", "+5%"),
}

# +2 dB lowshelf at 160 Hz for Yunyang lines to keep spectral warmth balanced with Yunjian
DEFAULT_EQ_BOOSTS = {
    "check": 2.0,
    "capture": 2.0,
}

AUDITION3_VOICE = "zh-CN-YunyangNeural"
AUDITION3_PITCH = "-20Hz"
AUDITION3_RATES = ["-10%", "+0%", "+5%", "+10%"]
AUDITION3_LINES = [
    ("check", "将军！", "將軍", "jiāng jūn"),
    ("capture_1", "吃！", "吃", "chī"),
    ("capture_2", "杀！", "殺", "shā"),
]

VOICE_LINES = {
    "start": [
        {"file": "start_1.mp3", "tts": "请！", "caption": "請", "pinyin": "qǐng", "vi": "Bắt đầu!", "gain": 1.0, "max_dur": 0.50},
    ],
    "capture": [
        {"file": "capture_1.mp3", "tts": "吃！", "caption": "吃", "pinyin": "chī", "vi": "", "gain": 1.0, "max_dur": 0.50},
        {"file": "capture_2.mp3", "tts": "杀！", "caption": "殺", "pinyin": "shā", "vi": "", "gain": 1.0, "max_dur": 0.50},
    ],
    "check": [
        {"file": "check_1.mp3", "tts": "将军！", "caption": "將軍", "pinyin": "jiāng jūn", "vi": "Chiếu tướng!", "gain": 1.0, "max_dur": 0.75},
    ],
    "checkmate": [
        {"file": "checkmate_1.mp3", "tts": "将死！", "caption": "將死", "pinyin": "jiāng sǐ", "vi": "Chiếu bí!", "gain": 1.0, "max_dur": 0.95},
        {"file": "checkmate_2.mp3", "tts": "承让。", "caption": "承讓", "pinyin": "chéng ràng", "vi": "Đa tạ đã nhường!", "gain": 1.0, "max_dur": 0.60},
    ],
    "draw": [
        {"file": "draw_1.mp3", "tts": "和棋。", "caption": "和棋", "pinyin": "hé qí", "vi": "Hòa cờ", "gain": 1.0, "max_dur": 0.50},
    ],
}

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIR = ROOT / "assets" / "voice"
AUDITION3_DIR = ROOT / "preview" / "voices" / "audition3"


def parse_voice_map(spec_str):
    """Parse 'event=voice:pitch:rate,event2=...' into dict."""
    out = dict(DEFAULT_VOICE_MAP)
    if not spec_str:
        return out
    for part in spec_str.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        ev, val = part.split("=", 1)
        pieces = val.split(":")
        if len(pieces) != 3:
            raise ValueError(f"Invalid --voice-map entry '{part}'; expected event=voice:pitch:rate")
        out[ev.strip()] = (pieces[0].strip(), pieces[1].strip(), pieces[2].strip())
    return out


async def synth_to_file(text, voice, pitch, rate, volume, out_path):
    tmp_path = out_path.with_suffix(".tmp.mp3")
    last_err = None
    for attempt in range(3):
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
            await comm.save(str(tmp_path))
            if tmp_path.exists() and tmp_path.stat().st_size > 1000:
                tmp_path.replace(out_path)
                return
        except Exception as exc:
            last_err = exc
            await asyncio.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed to synthesize {out_path.name}: {last_err}")


async def run_audition3(volume):
    AUDITION3_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    for rate in AUDITION3_RATES:
        r_tag = rate.replace("%", "").replace("-", "m").replace("+", "p")
        for tag, tts, cap, pinyin in AUDITION3_LINES:
            fname = f"{AUDITION3_VOICE}_pm20_r{r_tag}_{tag}.mp3"
            out_path = AUDITION3_DIR / fname
            await synth_to_file(tts, AUDITION3_VOICE, AUDITION3_PITCH, rate, volume, out_path)
            size = out_path.stat().st_size
            print(f"[audition3] {fname} ({size} bytes)")
            entries.append({
                "file": fname,
                "voice": AUDITION3_VOICE,
                "pitch": AUDITION3_PITCH,
                "rate": rate,
                "volume": volume,
                "tts": tts,
                "caption": cap,
                "pinyin": pinyin,
                "group": "Yunyang -20Hz",
            })

    (AUDITION3_DIR / "audition3.json").write_text(
        json.dumps({"entries": entries}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[audition3] saved {len(entries)} samples + audition3.json")


async def generate_final(default_voice, default_pitch, default_rate, volume, voice_map, per_file_rates, eq_boosts):
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    manifest_files = {}

    for event_name, items in VOICE_LINES.items():
        ev_voice, ev_pitch, ev_rate = voice_map.get(event_name, (default_voice, default_pitch, default_rate))
        manifest_files[event_name] = []
        for item in items:
            eff_rate = per_file_rates.get(item["file"], ev_rate)
            eq_boost = eq_boosts.get(item["file"], eq_boosts.get(event_name, 0))
            out_path = ASSET_DIR / item["file"]
            await synth_to_file(item["tts"], ev_voice, ev_pitch, eff_rate, volume, out_path)
            size = out_path.stat().st_size
            print(f"[voice] {event_name}: {item['file']} ({ev_voice} {ev_pitch} {eff_rate}, {size} bytes)")
            manifest_files[event_name].append({
                "file": item["file"],
                "tts": item["tts"],
                "caption": item["caption"],
                "pinyin": item["pinyin"],
                "vi": item["vi"],
                "gain": item["gain"],
                "eqBoost": eq_boost,
                "voice": {
                    "name": ev_voice,
                    "pitch": ev_pitch,
                    "rate": eff_rate,
                },
                "maxDur": item["max_dur"],
            })

    manifest = {
        "method": "edge-tts",
        "version": str(int(time.time())),
        "voice": default_voice,
        "pitch": default_pitch,
        "rate": default_rate,
        "volume": volume,
        "voiceMap": {
            k: {"name": v[0], "pitch": v[1], "rate": v[2]}
            for k, v in voice_map.items()
        },
        "files": manifest_files,
    }
    (ASSET_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[voice] wrote assets/voice/manifest.json (v={manifest['version']})")


async def main_async(args):
    voice_map = parse_voice_map(args.voice_map)
    if not args.skip_audition:
        await run_audition3(args.volume)

    per_file = {}
    if args.file_rate:
        for spec in args.file_rate:
            fname, r = spec.split("=", 1)
            per_file[fname.strip()] = r.strip()

    eq_boosts = dict(DEFAULT_EQ_BOOSTS)
    if args.eq_boost:
        for spec in args.eq_boost:
            k, v = spec.split("=", 1)
            eq_boosts[k.strip()] = float(v.strip())

    await generate_final(args.voice, args.pitch, args.rate, args.volume, voice_map, per_file, eq_boosts)


def main():
    parser = argparse.ArgumentParser(description="Generate Xiangqi Chinese voice lines via edge-tts")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"Default voice (default: {DEFAULT_VOICE})")
    parser.add_argument("--pitch", default=DEFAULT_PITCH, help=f"Default pitch (default: {DEFAULT_PITCH})")
    parser.add_argument("--rate", default=DEFAULT_RATE, help=f"Default rate (default: {DEFAULT_RATE})")
    parser.add_argument("--volume", default=DEFAULT_VOLUME, help=f"Volume boost (default: {DEFAULT_VOLUME})")
    parser.add_argument("--voice-map", default="", help="Per-event map: event=voice:pitch:rate,...")
    parser.add_argument("--file-rate", action="append", help="Override rate for one file, e.g. check_1.mp3=+10%")
    parser.add_argument("--eq-boost", action="append", help="Per-event/file lowshelf boost dB at 160 Hz, e.g. check=2")
    parser.add_argument("--skip-audition", action="store_true", help="Skip generating preview/voices/audition3/")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
