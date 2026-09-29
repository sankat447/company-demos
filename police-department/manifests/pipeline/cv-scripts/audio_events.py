#!/usr/bin/env python3
"""Acoustic gunshot-candidate detector -> <clip>/.audio_events.json

Gunshots are the most reliable "shots fired" cue in CCTV: an impulse that
rises >10 dB within ~10 ms, is broadband (high spectral flatness) and dies
out within a few hundred ms. Whisper transcribes speech only, so the
pipeline never listened for them before.

Reads <clip>/audio.wav (16 kHz mono PCM, written by extract-keyframes).
Pure numpy, no model. Results are CANDIDATES: door slams and dropped
objects also make impulses — event-fusion/shots-fusion decide how much
weight to give them by cross-checking pose, weapon and flash evidence.

usage: audio_events.py <clip_dir>
"""
import json
import os
import sys
import wave

import numpy as np

FRAME_MS = 10
BG_WINDOW_S = 2.0          # rolling-median background length
MIN_OVER_BG_DB = 15.0      # impulse must stand this far above background
MIN_RISE_DB = 9.0          # ...and jump this much within one 10 ms frame
MIN_FLATNESS = 0.45        # broadband (speech/music is tonal, lower)
MAX_DURATION_MS = 450      # longer events are not impulses
BURST_GAP_S = 1.5          # impulses closer than this form one burst
SILENT_PEAK = 1e-4         # below this the track carries no signal
SKIP_START_S = 0.5         # AAC/encoder priming makes the first frames jump from digital silence
LOW_LEVEL_PEAK_DBFS = -40  # very quiet recordings -> relative dB is noisy


def main(clip_dir):
    out_path = os.path.join(clip_dir, ".audio_events.json")

    def write(obj):
        with open(out_path, "w") as f:
            json.dump(obj, f)

    wav_path = os.path.join(clip_dir, "audio.wav")
    if not os.path.exists(wav_path) or os.path.getsize(wav_path) < 1000:
        write({"available": False, "reason": "clip has no audio track"})
        print("[audio-events] no audio track", flush=True)
        return

    with wave.open(wav_path, "rb") as w:
        sr, nch = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
    if nch > 1:
        x = x.reshape(-1, nch).mean(1)
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak < SILENT_PEAK:
        write({"available": False, "reason": "audio track is silent", "peak": peak})
        print("[audio-events] silent audio track", flush=True)
        return

    win = int(sr * FRAME_MS / 1000)
    n = len(x) // win
    frames = x[: n * win].reshape(n, win)
    env_db = 20 * np.log10(np.sqrt((frames ** 2).mean(1)) + 1e-7)
    k = int(BG_WINDOW_S * 1000 / FRAME_MS)
    padded = np.pad(env_db, (k // 2, k - k // 2 - 1), mode="edge")
    bg_db = np.median(np.lib.stride_tricks.sliding_window_view(padded, k), axis=1)
    rise_db = np.r_[0.0, np.diff(env_db)]
    spec = np.abs(np.fft.rfft(frames * np.hanning(win), axis=1)) + 1e-9
    flatness = np.exp(np.log(spec).mean(1)) / spec.mean(1)

    impulses = []
    i = int(SKIP_START_S * 1000 / FRAME_MS)
    while i < n:
        if env_db[i] - bg_db[i] >= MIN_OVER_BG_DB and rise_db[i] >= MIN_RISE_DB:
            j = i
            while j + 1 < n and env_db[j + 1] > bg_db[j + 1] + 6:
                j += 1
            dur_ms = (j - i + 1) * FRAME_MS
            seg = slice(i, j + 1)
            flat = float(flatness[seg].max())
            if dur_ms <= MAX_DURATION_MS and flat >= MIN_FLATNESS:
                impulses.append({
                    "sec": round(i * FRAME_MS / 1000, 2),
                    "dur_ms": dur_ms,
                    "over_bg_db": round(float((env_db[seg] - bg_db[seg]).max()), 1),
                    "rise_db": round(float(rise_db[i]), 1),
                    "flatness": round(flat, 2),
                })
            i = j + 5
        else:
            i += 1

    bursts, cur = [], []
    for imp in impulses:
        if cur and imp["sec"] - cur[-1]["sec"] > BURST_GAP_S:
            bursts.append(cur)
            cur = []
        cur.append(imp)
    if cur:
        bursts.append(cur)
    burst_out = [{"start_sec": b[0]["sec"], "end_sec": b[-1]["sec"], "count": len(b)}
                 for b in bursts if len(b) >= 2]
    for imp in impulses:
        imp["in_burst"] = any(b["start_sec"] <= imp["sec"] <= b["end_sec"] for b in burst_out)

    peak_dbfs = round(float(20 * np.log10(peak)), 1)
    low_level = bool(peak_dbfs < LOW_LEVEL_PEAK_DBFS)
    write({
        "available": True,
        "detector": "impulse-dsp-v1",
        "sample_rate": sr,
        "duration_sec": round(len(x) / sr, 2),
        "peak_dbfs": peak_dbfs,
        "low_level_audio": low_level,
        "note": ("recording level is very low; impulses are relative to a quiet floor, "
                 "treat as weak evidence" if low_level else "normal recording level"),
        "impulses": impulses,
        "bursts": burst_out,
    })
    print(f"[audio-events] peak={peak_dbfs}dBFS low_level={low_level} impulses={len(impulses)} "
          f"bursts={len(burst_out)}", flush=True)
    for imp in impulses:
        print(f"  impulse @ {imp['sec']}s  +{imp['over_bg_db']}dB rise={imp['rise_db']}dB "
              f"flat={imp['flatness']} burst={imp['in_burst']}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
