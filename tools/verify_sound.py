"""
OfflineAudioContext sound verification & WAV exporter for Chinese Chess SFX.
Checks:
  - move: peak in [0.80, 0.97], RMS >= 0.14, attack time (to 80% peak) <= 4 ms, spectral centroid >= 1200 Hz
  - capture: peak in [0.88, 0.98], RMS >= 0.20, attack time <= 4 ms
  - all events: RMS > 0.005, peak <= 0.98, no NaN, duration within target, no DC click on tonal sounds
Exports:
  - preview/sounds/<event>.wav (including move_classic.wav, capture_classic.wav)
  - preview/sounds/seq_capture_check.wav (capture clack @ 0ms -> drum @ 40ms -> voice @ 70ms -> gong @ 80ms)
    and asserts peak <= 0.95.
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
OUT_DIR = ROOT / "preview" / "sounds"


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


def write_mono_wav(path, samples, sample_rate):
    pcm = bytearray()
    for s in samples:
        clamped = max(-1.0, min(1.0, float(s)))
        pcm.extend(struct.pack("<h", int(round(clamped * 32767))))
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(pcm))


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


def spectral_centroid_hz(samples, sample_rate, fft_n=1024):
    """Compute magnitude-weighted spectral centroid over the first fft_n samples (Hann windowed)."""
    n = min(fft_n, len(samples))
    # Simple radix-2 DFT on n=512 (fast in Python for a handful of short sounds)
    n = 512 if n >= 512 else 256
    win = [samples[i] * (0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1))) for i in range(n)]
    num = 0.0
    den = 0.0
    half = n // 2
    two_pi_over_n = 2.0 * math.pi / n
    for k in range(1, half):
        re = 0.0
        im = 0.0
        ang_step = two_pi_over_n * k
        for t in range(n):
            a = ang_step * t
            re += win[t] * math.cos(a)
            im -= win[t] * math.sin(a)
        mag = math.hypot(re, im)
        freq = (k * sample_rate) / n
        num += freq * mag
        den += mag
    return num / den if den > 1e-12 else 0.0


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
                const mod = await import('./js/audio/synth.js');
                const voiceMod = await import('./js/audio/voice.js');
                const sfxMod = await import('./js/audio/sfx.js');
                const list = [...mod.SOUND_EVENTS, 'move_classic', 'capture_classic'];
                const out = [];

                for (const ev of list) {
                    const buf = await mod.renderSoundBuffer(ev, 44100);
                    const ch = buf.getChannelData(0);
                    const meta = mod.SOUND_META[ev];
                    let peak = 0;
                    let sumSq = 0;
                    let hasBad = false;
                    let first2msPeak = 0;
                    const first2msSamples = Math.min(ch.length, Math.floor(buf.sampleRate * 0.002));
                    for (let i = 0; i < ch.length; i++) {
                        const v = ch[i];
                        if (!Number.isFinite(v)) hasBad = true;
                        const a = Math.abs(v);
                        if (a > peak) peak = a;
                        if (i < first2msSamples && a > first2msPeak) first2msPeak = a;
                        sumSq += v * v;
                    }
                    // Attack time: first sample reaching 80% of peak
                    const thresh80 = peak * 0.8;
                    let attackIdx = 0;
                    for (let i = 0; i < ch.length; i++) {
                        if (Math.abs(ch[i]) >= thresh80) { attackIdx = i; break; }
                    }
                    const rms = Math.sqrt(sumSq / ch.length);
                    out.push({
                        event: ev,
                        duration: buf.duration,
                        targetDuration: meta.duration,
                        isNoiseBurst: meta.isNoiseBurst,
                        sampleRate: buf.sampleRate,
                        peak,
                        rms,
                        attackMs: (attackIdx / buf.sampleRate) * 1000,
                        first2msPeak,
                        hasBad,
                        samples: Array.from(ch),
                    });
                }

                // Render full capture-with-check sequence:
                // capture clack @ 0 ms -> drum @ 40 ms -> voice "將軍" @ 70 ms -> ducked gong @ 80 ms
                const sr = 44100;
                const capBuf = await mod.renderSoundBuffer('capture', sr);
                const drumBuf = await mod.renderSoundBuffer('drum', sr);
                const gongBuf = await mod.renderSoundBuffer('check', sr);
                const vResp = await fetch('assets/voice/check_1.mp3');
                const vArr = await vResp.arrayBuffer();
                const dec = new OfflineAudioContext(1, sr, sr);
                const vRaw = await dec.decodeAudioData(vArr);
                const vBuf = voiceMod.trimSilence(dec, vRaw);
                const vGainVal = voiceMod.computeNormalizedGain(vBuf, 1.0);

                const seqSec = 2.1;
                const off = new OfflineAudioContext(2, Math.ceil(seqSec * sr), sr);
                const limiter = off.createDynamicsCompressor();
                limiter.threshold.setValueAtTime(-3, 0);
                limiter.knee.setValueAtTime(0, 0);
                limiter.ratio.setValueAtTime(20, 0);
                limiter.attack.setValueAtTime(0.001, 0);
                limiter.release.setValueAtTime(0.06, 0);

                const master = off.createGain();
                master.gain.setValueAtTime(0.7, 0);
                master.connect(limiter);
                limiter.connect(off.destination);

                const sfxBus = off.createGain();
                sfxBus.gain.setValueAtTime(sfxMod.SFX_BUS_GAIN, 0);
                sfxBus.connect(master);

                const gongBus = off.createGain();
                gongBus.gain.setValueAtTime(sfxMod.GONG_GAIN, 0);
                gongBus.connect(master);

                const voiceBus = off.createGain();
                voiceBus.gain.setValueAtTime(sfxMod.VOICE_BUS_GAIN, 0);
                voiceBus.connect(master);

                const sCap = off.createBufferSource();
                sCap.buffer = capBuf;
                sCap.connect(sfxBus);
                sCap.start(0);

                const sDrum = off.createBufferSource();
                sDrum.buffer = drumBuf;
                const gDrum = off.createGain();
                gDrum.gain.setValueAtTime(0.85, 0);
                sDrum.connect(gDrum);
                gDrum.connect(gongBus);
                sDrum.start(0.04);

                const chain = voiceMod.createVoiceChain(off, voiceBus);
                const sVoice = off.createBufferSource();
                sVoice.buffer = vBuf;
                const gVoice = off.createGain();
                voiceMod.applyTransientBoost(gVoice, vGainVal, 0.07);
                sVoice.connect(gVoice);
                gVoice.connect(chain.input);
                sVoice.start(0.07);

                const sGong = off.createBufferSource();
                sGong.buffer = gongBuf;
                const gGong = off.createGain();
                gGong.gain.setValueAtTime(0.447, 0);
                sGong.connect(gGong);
                gGong.connect(gongBus);
                sGong.start(0.08);

                const seqRendered = await off.startRendering();
                const sl = seqRendered.getChannelData(0);
                const srCh = seqRendered.getChannelData(1);
                let seqPeak = 0;
                for (let i = 0; i < sl.length; i++) {
                    const a = Math.max(Math.abs(sl[i]), Math.abs(srCh[i]));
                    if (a > seqPeak) seqPeak = a;
                }

                return {
                    sounds: out,
                    seq: {
                        peak: seqPeak,
                        sampleRate: sr,
                        left: Array.from(sl),
                        right: Array.from(srCh),
                    },
                };
            }""")
            browser.close()
    finally:
        server.shutdown()

    print("| event | duration | peak | RMS | attack ms | centroid Hz |")
    print("|---|---:|---:|---:|---:|---:|")
    centroids = {}
    for r in data["sounds"]:
        ev = r["event"]
        dur = r["duration"]
        peak = r["peak"]
        rms = r["rms"]
        atk = r["attackMs"]
        f2 = r["first2msPeak"]
        centroid = spectral_centroid_hz(r["samples"], r["sampleRate"])
        centroids[ev] = centroid
        write_mono_wav(OUT_DIR / f"{ev}.wav", r["samples"], r["sampleRate"])
        print(f"| {ev} | {dur:.3f} s | {peak:.4f} | {rms:.4f} | {atk:.2f} ms | {centroid:.0f} Hz |")

        if r["hasBad"]:
            print(f"FAIL [{ev}]: contains NaN/Infinity")
            failed = True
        if rms <= 0.005:
            print(f"FAIL [{ev}]: RMS {rms:.5f} <= 0.005")
            failed = True
        if peak > 0.98:
            print(f"FAIL [{ev}]: peak {peak:.4f} > 0.98")
            failed = True
        if not r["isNoiseBurst"] and f2 >= 0.2:
            print(f"FAIL [{ev}]: first 2 ms peak {f2:.4f} >= 0.2 (DC click)")
            failed = True
        if abs(dur - r["targetDuration"]) > 0.05:
            print(f"FAIL [{ev}]: duration {dur:.3f}s outside target {r['targetDuration']:.3f}s")
            failed = True

        if ev == "move":
            if not (0.80 <= peak <= 0.97):
                print(f"FAIL [move]: peak {peak:.4f} not in [0.80, 0.97]")
                failed = True
            if rms < 0.14:
                print(f"FAIL [move]: RMS {rms:.4f} < 0.14")
                failed = True
            if atk > 4.0:
                print(f"FAIL [move]: attack {atk:.2f} ms > 4.0 ms")
                failed = True
            if centroid < 1200:
                print(f"FAIL [move]: centroid {centroid:.0f} Hz < 1200 Hz")
                failed = True
        elif ev == "capture":
            if not (0.88 <= peak <= 0.98):
                print(f"FAIL [capture]: peak {peak:.4f} not in [0.88, 0.98]")
                failed = True
            if rms < 0.20:
                print(f"FAIL [capture]: RMS {rms:.4f} < 0.20")
                failed = True
            if atk > 4.0:
                print(f"FAIL [capture]: attack {atk:.2f} ms > 4.0 ms")
                failed = True

    seq = data["seq"]
    write_stereo_wav(OUT_DIR / "seq_capture_check.wav", seq["left"], seq["right"], seq["sampleRate"])
    print(f"[seq_capture_check.wav] peak={seq['peak']:.4f} | offsets: capture=0ms, drum=40ms, voice=70ms, gong=80ms (capture-only voice=20ms)")
    if seq["peak"] > 0.95:
        print(f"FAIL [seq_capture_check.wav]: peak {seq['peak']:.4f} > 0.95")
        failed = True

    if failed:
        sys.exit(1)
    print(f"All {len(data['sounds'])} sound buffers + seq_capture_check.wav verified.")


if __name__ == "__main__":
    main()
