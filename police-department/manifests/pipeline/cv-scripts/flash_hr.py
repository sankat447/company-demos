#!/usr/bin/env python3
"""High-frame-rate muzzle-flash scan -> <clip>/.flashes_hr.json

Lesson 17.42: muzzle flashes last ~30 ms but dense_frames are sampled at
the tracker rate (8-15 fps, 66-125 ms gaps), so most flashes fall between
samples. This step decodes the RAW video at its native rate (typically
30 fps, 33 ms gaps) and looks for single-frame brightness transients:
a 16x16 cell that is much brighter than BOTH its previous and next frame
(a flash appears for 1 frame; headlights/people moving persist).

Two scopes:
  * per-track: inside each person's bbox expanded by 60% sideways/up to
    cover an extended arm + muzzle (bboxes from .tracks.json, dense coords,
    nearest sample within 0.3 s);
  * scene: anywhere in frame, for shooters the tracker lost.

Thresholds adapt to lighting: at night a flash is a large jump; in daylight
flashes are faint and the scan mostly returns nothing — callers must treat
"no flash" as inconclusive, never as "no shots fired".

usage: flash_hr.py <clip_dir>   (needs cv2 + numpy from the shared PVC)
"""
import bisect
import json
import os
import sys

import numpy as np

CELL = 16
SCAN_W = 640              # decode width; matches dense_frames coord space
TRACK_WINDOW_S = 0.30     # bbox must be sampled within this of the frame
EXPAND_X, EXPAND_UP = 0.60, 0.30
MAX_CANDIDATES = 40


def main(clip_dir):
    import cv2

    out_path = os.path.join(clip_dir, ".flashes_hr.json")

    def write(obj):
        with open(out_path, "w") as f:
            json.dump(obj, f)

    video = os.path.join(clip_dir, "clip.mp4")
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        write({"available": False, "reason": "cannot open clip.mp4"})
        return
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    tracks = {}
    try:
        with open(os.path.join(clip_dir, ".tracks.json")) as f:
            tj = json.load(f)
        dense_w = float(tj.get("dense_w") or SCAN_W)
        for tid, t in (tj.get("tracks") or {}).items():
            dets = t.get("detections") or []
            if dets:
                tracks[tid] = ([d["sec"] for d in dets], [d["bbox"] for d in dets])
    except (FileNotFoundError, ValueError):
        dense_w = SCAN_W
    to_scan = SCAN_W / dense_w  # dense coords -> scan coords

    def track_boxes(sec, h):
        boxes = []
        for tid, (secs, bbs) in tracks.items():
            i = bisect.bisect_left(secs, sec)
            best = min((j for j in (i - 1, i) if 0 <= j < len(secs)),
                       key=lambda j: abs(secs[j] - sec), default=None)
            if best is None or abs(secs[best] - sec) > TRACK_WINDOW_S:
                continue
            x1, y1, x2, y2 = [v * to_scan for v in bbs[best]]
            bw, bh = x2 - x1, y2 - y1
            boxes.append((tid, max(0, x1 - EXPAND_X * bw), max(0, y1 - EXPAND_UP * bh),
                          min(SCAN_W, x2 + EXPAND_X * bw), min(h, y2)))
        return boxes

    prev = cur = None
    cur_sec = 0.0
    idx = -1
    lum = []
    raw = []   # (sec, rise, peak, cx, cy): strongest cell of each middle frame of a triple
    scan_h = None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if scan_h is None:
            scan_h = int(round(g.shape[0] * SCAN_W / g.shape[1])) // CELL * CELL
        g = cv2.resize(g, (SCAN_W, scan_h), interpolation=cv2.INTER_AREA)
        cells = g.reshape(scan_h // CELL, CELL, SCAN_W // CELL, CELL)
        mean = cells.mean(axis=(1, 3)).astype(np.float32)
        peakc = cells.max(axis=(1, 3))
        lum.append(float(mean.mean()))
        if prev is not None and cur is not None:
            spike = np.minimum(cur[0] - prev[0], cur[0] - mean)
            r, c = np.unravel_index(int(spike.argmax()), spike.shape)
            raw.append((cur_sec, float(spike[r, c]), int(cur[1][r, c]), c * CELL + CELL // 2, r * CELL + CELL // 2))
        prev, cur, cur_sec = cur, (mean, peakc), idx / fps
    cap.release()
    n = idx + 1
    if n < 3:
        write({"available": False, "reason": "too few frames"})
        return

    avg_lum = float(np.mean(lum))
    night = avg_lum < 70
    # Adaptive threshold: well above the clip's own transient noise floor.
    rises = np.array([x[1] for x in raw])
    noise = float(np.percentile(rises, 99)) if rises.size else 0.0
    thresh = max(40.0 if night else 25.0, noise * 3.0)
    min_peak = 200 if night else 230

    cands = sorted((x for x in raw if x[1] >= thresh and x[2] >= min_peak), key=lambda x: -x[1])[:MAX_CANDIDATES]
    tracks_with = {}
    scene = []
    for sec, rise, peak, cx, cy in sorted(cands, key=lambda x: x[0]):
        hit = [tid for tid, x1, y1, x2, y2 in track_boxes(sec, scan_h) if x1 <= cx <= x2 and y1 <= cy <= y2]
        entry = {"sec": round(sec, 3), "rise": round(rise, 1), "peak": peak, "x": cx, "y": cy}
        scene.append({**entry, "tracks": hit})
        for tid in hit:
            tracks_with.setdefault(tid, {"flashes": []})["flashes"].append(entry)

    write({
        "available": True,
        "detector": "native-fps-transient-v1",
        "fps_scanned": round(fps, 2),
        "frames_scanned": n,
        "frame_gap_ms": round(1000 / fps, 1),
        "coord_space": "scan_640",
        "lighting": "NIGHT" if night else "DAY",
        "mean_luminance": round(avg_lum, 1),
        "rise_threshold": round(thresh, 1),
        "noise_p99": round(noise, 1),
        "note": ("daylight: muzzle flashes are usually below the visible threshold — "
                 "no flash is NOT evidence of no shots" if not night else "night: flashes are high-contrast"),
        "num_tracks_with_flashes": len(tracks_with),
        "tracks_with_flashes": tracks_with,
        "scene_flashes": scene,
    })
    print(f"[flash-hr] scanned {n} frames @ {fps:.2f}fps ({1000/fps:.0f}ms gaps) lighting={'NIGHT' if night else 'DAY'} "
          f"threshold={thresh:.1f} candidates={len(scene)} tracks_with_flashes={len(tracks_with)}", flush=True)
    for s in scene[:12]:
        print(f"  flash @ {s['sec']}s rise={s['rise']} peak={s['peak']} at ({s['x']},{s['y']}) tracks={s['tracks']}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
