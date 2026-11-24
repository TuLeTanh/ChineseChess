"""
Playwright OfflineAudioContext verification for decisive Chinese voice lines:
- Prints voice used per file, raw vs trimmed durations, targets met, peak, RMS, gain,
  and processed spectral centroid (comparing Yunyang vs Yunjian).
- Asserts per-file trimmed targets, RMS > 0.01, raw peak <= 0.98, processed peak <= 0.95.
- Exports preview/voices/<event>_processed.wav.
"""
import functools
import http.server
import math
import struct
import sys
import threading
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "preview" / "voices"

TARGETS = {
    "start_1.mp3": (0.20, 0.50),
    "capture_1.mp3": (0.20, 0.50),
    "capture_2.mp3": (0.20, 0.50),
    "draw_1.mp3": (0.20, 0.50),
    "check_1.mp3": (0.35, 0.75),
    "checkmate_1.mp3": (0.30, 0.95),
    "checkmate_2.mp3": (0.20, 0.60),
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def write_stereo_wav(path, left, right, sample_rate):
    pcm = bytearray()
    for l_val, r_val in zip(left, right):
        cl = max(-1.0, min(1.0, float(l_val)))
        cr = max(-1.0, min(1.0, float(r_val)))
        pcm.extend(struct.pack("<hh", int(round(cl * 32767)), int(round(cr * 32767))))
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(pcm))


def avg_spectral_centroid(samples, sample_rate):
    """Average spectral centroid over active 512-sample windows."""
    n = 512
    hop = 512
    half = n // 2
    two_pi_over_n = 2.0 * math.pi / n
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    centroids = []
    for start in range(0, len(samples) - n, hop):
        frame = samples[start : start + n]
        energy = sum(x * x for x in frame) / n
        if energy < 0.0005:
            continue
        num = 0.0
        den = 0.0
        for k in range(1, half, 2):
            re = 0.0
            im = 0.0
            step = two_pi_over_n * k
            for t in range(n):
                w = frame[t] * win[t]
                a = step * t
                re += w * math.cos(a)
                im -= w * math.sin(a)
            mag = math.hypot(re, im)
            num += ((k * sample_rate) / n) * mag
            den += mag
        if den > 1e-9:
            centroids.append(num / den)
    return sum(centroids) / len(centroids) if centroids else 0.0


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    failed = False

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(f"{base}/?sounds", wait_until="networkidle")

            data = page.evaluate("""async () => {
                const voiceMod = await import('./js/audio/voice.js');
                const synthMod = await import('./js/audio/synth.js');
                const resp = await fetch('assets/voice/manifest.json?v=' + Date.now());
                const manifest = await resp.json();

                const decodeCtx = new OfflineAudioContext(1, 44100, 44100);
                const drumBuf = await synthMod.renderSoundBuffer('drum', 44100);
                const rawStats = [];
                const processedOut = [];

                for (const [ev, list] of Object.entries(manifest.files)) {
                    for (let idx = 0; idx < list.length; idx++) {
                        const meta = list[idx];
                        const r = await fetch('assets/voice/' + meta.file + '?v=' + (manifest.version || Date.now()));
                        const arr = await r.arrayBuffer();
                        const rawBuf = await decodeCtx.decodeAudioData(arr);
                        const buf = voiceMod.trimSilence(decodeCtx, rawBuf);

                        const ch = buf.getChannelData(0);
                        let peak = 0;
                        let sumSq = 0;
                        for (let i = 0; i < ch.length; i++) {
                            const a = Math.abs(ch[i]);
                            if (a > peak) peak = a;
                            sumSq += ch[i] * ch[i];
                        }
                        const rms = Math.sqrt(sumSq / ch.length);
                        const appliedGain = voiceMod.computeNormalizedGain(buf, meta.gain ?? 1.0);
                        const vInfo = meta.voice || { name: manifest.voice, pitch: manifest.pitch, rate: manifest.rate };
                        const eqBoost = Number(meta.eqBoost || 0);

                        // Render voice-only through chain for pure voice centroid measurement
                        const sr = 44100;
                        const offV = new OfflineAudioContext(2, Math.ceil((buf.duration + 0.5) * sr), sr);
                        const chainV = voiceMod.createVoiceChain(offV, offV.destination, eqBoost);
                        const srcV = offV.createBufferSource();
                        srcV.buffer = buf;
                        const gV = offV.createGain();
                        voiceMod.applyTransientBoost(gV, appliedGain, 0);
                        srcV.connect(gV);
                        gV.connect(chainV.input);
                        srcV.start(0);
                        const renV = await offV.startRendering();

                        // Render full mix with drum + limiter for preview WAV
                        const drumLead = ev === 'checkmate' && idx === 0 ? 0.30 : (ev === 'check' ? 0.03 : 0);
                        const totalSec = Math.max(0.8, drumLead + buf.duration + 0.55);
                        const off = new OfflineAudioContext(2, Math.ceil(totalSec * sr), sr);

                        const limiter = off.createDynamicsCompressor();
                        limiter.threshold.setValueAtTime(-3, 0);
                        limiter.knee.setValueAtTime(0, 0);
                        limiter.ratio.setValueAtTime(20, 0);
                        limiter.attack.setValueAtTime(0.001, 0);
                        limiter.release.setValueAtTime(0.06, 0);

                        const masterGain = off.createGain();
                        masterGain.gain.setValueAtTime(0.7, 0);
                        masterGain.connect(limiter);
                        limiter.connect(off.destination);

                        const chain = voiceMod.createVoiceChain(off, masterGain, eqBoost);
                        const src = off.createBufferSource();
                        src.buffer = buf;
                        const g = off.createGain();
                        voiceMod.applyTransientBoost(g, appliedGain, drumLead);
                        src.connect(g);
                        g.connect(chain.input);
                        src.start(drumLead);

                        if (ev === 'check') {
                            const d = off.createBufferSource();
                            d.buffer = drumBuf;
                            const dg = off.createGain();
                            dg.gain.setValueAtTime(0.68, 0);
                            d.connect(dg);
                            dg.connect(masterGain);
                            d.start(0);
                        } else if (ev === 'checkmate' && idx === 0) {
                            for (const t of [0.08, 0.22]) {
                                const d = off.createBufferSource();
                                d.buffer = drumBuf;
                                const dg = off.createGain();
                                dg.gain.setValueAtTime(0.72, 0);
                                d.connect(dg);
                                dg.connect(masterGain);
                                d.start(t);
                            }
                        } else if (ev === 'start') {
                            const d = off.createBufferSource();
                            d.buffer = drumBuf;
                            const dg = off.createGain();
                            dg.gain.setValueAtTime(0.36, 0);
                            d.connect(dg);
                            dg.connect(masterGain);
                            d.start(0);
                        }

                        const rendered = await off.startRendering();
                        const l = rendered.getChannelData(0);
                        const rch = rendered.getChannelData(1);
                        let pPeak = 0;
                        for (let i = 0; i < l.length; i++) {
                            const a = Math.max(Math.abs(l[i]), Math.abs(rch[i]));
                            if (a > pPeak) pPeak = a;
                        }
                        const outStem = list.length > 1 ? `${ev}_${idx + 1}` : ev;

                        rawStats.push({
                            event: ev,
                            file: meta.file,
                            text: `${meta.caption} (${meta.pinyin})`,
                            voiceName: vInfo.name,
                            voiceSpec: `${vInfo.name.replace('zh-CN-', '')} ${vInfo.pitch} ${vInfo.rate}`,
                            eqBoost,
                            rawDuration: rawBuf.duration,
                            duration: buf.duration,
                            peak,
                            rms,
                            appliedGain,
                            voiceOnlySamples: Array.from(renV.getChannelData(0)),
                            sampleRate: sr,
                        });
                        processedOut.push({
                            name: outStem,
                            peak: pPeak,
                            sampleRate: sr,
                            left: Array.from(l),
                            right: Array.from(rch),
                        });
                    }
                }
                return { manifest, rawStats, processedOut };
            }""")
            browser.close()
    finally:
        server.shutdown()

    yunyang_centroids = []
    yunjian_centroids = []

    print("| file | text | voice | raw dur | trimmed dur | target | ok | peak | RMS | gain | centroid |")
    print("|---|---|---|---:|---:|---:|:---:|---:|---:|---:|---:|")
    for s in data["rawStats"]:
        lo, hi = TARGETS.get(s["file"], (0.20, 1.60))
        ok = (lo <= s["duration"] <= hi) and (s["rms"] > 0.01) and (s["peak"] <= 0.98)
        c = avg_spectral_centroid(s["voiceOnlySamples"], s["sampleRate"])
        if "Yunyang" in s["voiceName"]:
            yunyang_centroids.append(c)
        else:
            yunjian_centroids.append(c)
        print(
            f"| {s['file']} | {s['text']} | {s['voiceSpec']} | {s['rawDuration']:.3f} s | "
            f"{s['duration']:.3f} s | <= {hi:.2f} s | {'PASS' if ok else 'FAIL'} | "
            f"{s['peak']:.4f} | {s['rms']:.4f} | {s['appliedGain']:.2f}x | {c:.0f} Hz |"
        )
        if not ok:
            failed = True

    if yunyang_centroids and yunjian_centroids:
        avg_yy = sum(yunyang_centroids) / len(yunyang_centroids)
        avg_yj = sum(yunjian_centroids) / len(yunjian_centroids)
        ratio = avg_yy / avg_yj if avg_yj > 0 else 1.0
        print(f"Processed spectral centroids: Yunyang={avg_yy:.0f} Hz, Yunjian={avg_yj:.0f} Hz (ratio={ratio:.2f}x)")

    for p_out in data["processedOut"]:
        out_path = OUT_DIR / f"{p_out['name']}_processed.wav"
        write_stereo_wav(out_path, p_out["left"], p_out["right"], p_out["sampleRate"])
        if p_out["peak"] > 0.95:
            print(f"FAIL [processed {p_out['name']}]: peak {p_out['peak']:.4f} > 0.95")
            failed = True
        else:
            print(f"[processed] {out_path.name} peak={p_out['peak']:.4f} ok")

    if failed:
        sys.exit(1)
    print(f"All {len(data['rawStats'])} raw voices and {len(data['processedOut'])} processed WAVs verified.")


if __name__ == "__main__":
    main()
