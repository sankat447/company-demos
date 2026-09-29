#!/usr/bin/env python3
"""Shots-fired fusion + incident anchor frames. Runs after event-fusion.

Adds to <clip>/.events.json:
  * "shots_fired": assessment (LIKELY / POSSIBLE / INCONCLUSIVE) with tiered
    gunshot candidates, each carrying its evidence and suspected shooter;
  * gunshot candidates + scene-level flashes appended to master_timeline;
  * a BYSTANDER track aiming at the time of a HIGH/MEDIUM candidate is
    re-labelled ARMED_SUBJECT (reason recorded).

Evidence per candidate time t:
  audio  — impulse from .audio_events.json within 0.25 s (burst = stronger)
  flash  — native-fps transient from .flashes_hr.json within 0.25 s
  aim    — a track in "arm-extended" posture (.poses.json) within 1.0 s
  weapon — a weapon detection (.weapons.json) on a track within 2.0 s
Tiers:
  HIGH   audio+flash | burst+(aim|weapon) | flash-on-track+(aim|weapon)
  MEDIUM burst | audio+(aim|weapon) | flash+(aim|weapon) | weapon+aim
  LOW    anything else (single impulse or lone flash)
Aim and weapon evidence alone never create a candidate (people point and
reach); they only corroborate an acoustic or visual discharge.

Then extracts incident anchor frames (frames/anchor_<ms>.jpg, 1280 wide)
at t-0.5 s, t, t+0.5 s for the top incidents so the caption model sees
the moment itself, not just the nearest 1-2 s keyframe. Anchor list with
reasons goes to <clip>/.anchor-frames.json.

usage: shots_fusion.py <clip_dir>
"""
import json
import os
import sys

AUDIO_WIN, FLASH_WIN, AIM_WIN, WEAPON_WIN = 0.25, 0.25, 1.0, 2.0
MAX_ANCHOR_INCIDENTS = 4
ANCHOR_OFFSETS = (-0.5, 0.0, 0.5)
ANCHOR_W = 1280


def _load(path, default):
    try:
        with open(path) as f:
            data = json.load(f)
        return default if data.get("available") is False else data
    except (FileNotFoundError, ValueError):
        return default


def main(clip_dir):
    p = lambda name: os.path.join(clip_dir, name)
    events = _load(p(".events.json"), None)
    audio = _load(p(".audio_events.json"), {})
    flashes = _load(p(".flashes_hr.json"), {})
    poses = _load(p(".poses.json"), {})
    weapons = _load(p(".weapons.json"), {})

    impulses = audio.get("impulses") or []
    scene_flashes = flashes.get("scene_flashes") or []
    aims = []   # (start, end, track)
    for tid, t in (poses.get("tracks") or {}).items():
        for seg in t.get("segments") or []:
            if seg.get("posture") == "arm-extended":
                aims.append((seg["start_sec"], seg["end_sec"], tid))
    weapon_dets = []  # (sec, track, class, conf)
    for tid, w in (weapons.get("tracks_with_weapons") or {}).items():
        for d in w.get("detections") or []:
            weapon_dets.append((d["sec"], tid, d.get("class") or d.get("cls"), d.get("conf")))

    # Candidate times come only from discharge cues (sound or flash).
    times = sorted({round(i["sec"], 2) for i in impulses} | {round(f["sec"], 2) for f in scene_flashes})
    merged = []
    for t in times:
        if merged and t - merged[-1] <= 0.3:
            continue
        merged.append(t)

    candidates = []
    for t in merged:
        aud = [i for i in impulses if abs(i["sec"] - t) <= AUDIO_WIN]
        fl = [f for f in scene_flashes if abs(f["sec"] - t) <= FLASH_WIN]
        aim_tracks = sorted({a[2] for a in aims if a[0] - AIM_WIN <= t <= a[1] + AIM_WIN})
        wep = [w for w in weapon_dets if abs(w[0] - t) <= WEAPON_WIN]
        burst = any(i.get("in_burst") for i in aud)
        flash_on_track = any(f.get("tracks") for f in fl)
        corroborated = bool(aim_tracks or wep)
        if (aud and fl) or (burst and corroborated) or (flash_on_track and corroborated):
            tier = "HIGH"
        elif burst or (aud and corroborated) or (fl and corroborated):
            tier = "MEDIUM"
        else:
            tier = "LOW"
        if aud and audio.get("low_level_audio") and not fl and tier == "HIGH":
            tier = "MEDIUM"   # quiet recordings: don't let audio alone reach HIGH
        shooter_votes = {}
        for tid in aim_tracks:
            shooter_votes[tid] = shooter_votes.get(tid, 0) + 1
        for w in wep:
            shooter_votes[w[1]] = shooter_votes.get(w[1], 0) + 2
        for f in fl:
            for tid in f.get("tracks") or []:
                shooter_votes[tid] = shooter_votes.get(tid, 0) + 2
        shooter = max(shooter_votes, key=shooter_votes.get) if shooter_votes else None
        evidence = ([f"audio impulse +{aud[0]['over_bg_db']}dB" + (" (burst)" if burst else "")] if aud else []) + \
                   ([f"native-fps flash rise={fl[0]['rise']}"] if fl else []) + \
                   ([f"arm-extended: track(s) {', '.join(aim_tracks)}"] if aim_tracks else []) + \
                   ([f"weapon on track {wep[0][1]} ({wep[0][2]})"] if wep else [])
        candidates.append({"sec": t, "tier": tier, "suspected_shooter_track": int(shooter) if shooter else None,
                           "evidence": evidence})

    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    if any(c["tier"] == "HIGH" for c in candidates):
        verdict = "LIKELY"
    elif any(c["tier"] == "MEDIUM" for c in candidates):
        verdict = "POSSIBLE"
    else:
        verdict = "INCONCLUSIVE"
    caveats = []
    if flashes.get("lighting") == "DAY":
        caveats.append("daylight: muzzle flashes are rarely visible, flash absence is not evidence")
    if audio.get("low_level_audio"):
        caveats.append("very low recording level: acoustic impulses are weak evidence on their own")
    if not audio:
        caveats.append("no usable audio track")
    shots = {
        "assessment": verdict,
        "candidates": sorted(candidates, key=lambda c: (rank[c["tier"]], c["sec"])),
        "num_high": sum(c["tier"] == "HIGH" for c in candidates),
        "num_medium": sum(c["tier"] == "MEDIUM" for c in candidates),
        "audio_bursts": audio.get("bursts") or [],
        "caveats": caveats,
        "method": "audio impulse + native-fps flash + pose aim + weapon, tiered (shots_fusion v1)",
    }

    if events is None:   # event-fusion bailed (no tracks) — still record the acoustic/flash view
        events = {"available": True, "per_track": {}, "master_timeline": [], "cross_track_correlations": []}
    events["shots_fired"] = shots
    tl = events.setdefault("master_timeline", [])
    for c in candidates:
        if c["tier"] != "LOW":
            tl.append({"sec": c["sec"], "track_id": c["suspected_shooter_track"], "event": "gunshot_candidate",
                       "tier": c["tier"], "evidence": c["evidence"]})
    tl.sort(key=lambda e: e["sec"])
    for c in candidates:
        tid = c["suspected_shooter_track"]
        if c["tier"] in ("HIGH", "MEDIUM") and tid is not None:
            pt = events.get("per_track", {}).get(str(tid))
            if pt and pt["verdict"]["role"] == "BYSTANDER":
                pt["verdict"]["role"] = "ARMED_SUBJECT"
                pt["verdict"]["reason"] = f"suspected shooter: {'; '.join(c['evidence'])} @ {c['sec']}s"
    if events.get("per_track"):
        events["role_counts"] = {r: sum(1 for e in events["per_track"].values() if e["verdict"]["role"] == r)
                                 for r in ("VICTIM", "ARMED_SUBJECT", "FLEEING", "BYSTANDER")}
    with open(p(".events.json"), "w") as f:
        json.dump(events, f)
    print(f"[shots-fusion] assessment={verdict} candidates={len(candidates)} "
          f"high={shots['num_high']} medium={shots['num_medium']} caveats={caveats}", flush=True)
    for c in shots["candidates"][:10]:
        print(f"  {c['tier']:6} @ {c['sec']}s shooter={c['suspected_shooter_track']} :: {'; '.join(c['evidence'])}",
              flush=True)

    # ---- incident anchor frames --------------------------------------------------
    incidents = [(c["sec"], f"{c['tier']} gunshot candidate: {'; '.join(c['evidence'])}")
                 for c in shots["candidates"] if c["tier"] != "LOW"]
    for sec, tid, cls, conf in sorted(weapon_dets, key=lambda w: -(w[3] or 0)):
        incidents.append((sec, f"weapon ({cls}) on track {tid}"))
    for tid, t in (events.get("per_track") or {}).items():
        for e in t.get("events") or []:
            if e.get("event") in ("prone_interval", "fall_event") or e.get("violence_signal"):
                incidents.append((e["sec"], f"track {tid}: {e['event']}"))
    picked = []
    for sec, why in incidents:
        if all(abs(sec - s) > 1.5 for s, _ in picked):
            picked.append((sec, why))
        if len(picked) >= MAX_ANCHOR_INCIDENTS:
            break
    frames_dir = p("frames")
    for old in os.listdir(frames_dir) if os.path.isdir(frames_dir) else []:
        if old.startswith("anchor_"):
            os.remove(os.path.join(frames_dir, old))
    anchors = []
    if picked:
        import cv2
        cap = cv2.VideoCapture(p("clip.mp4"))
        dur = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / (cap.get(cv2.CAP_PROP_FPS) or 30.0)
        for sec, why in sorted(picked):
            for off in ANCHOR_OFFSETS:
                t = min(max(0.0, sec + off), max(0.0, dur - 0.05))
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
                ok, frame = cap.read()
                if not ok:
                    continue
                h, w = frame.shape[:2]
                if w > ANCHOR_W:
                    frame = cv2.resize(frame, (ANCHOR_W, int(h * ANCHOR_W / w)), interpolation=cv2.INTER_AREA)
                name = f"anchor_{int(round(t * 1000)):07d}.jpg"
                cv2.imwrite(os.path.join(frames_dir, name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                anchors.append({"file": name, "clip_time_sec": round(t, 2), "incident_sec": sec, "reason": why})
        cap.release()
    with open(p(".anchor-frames.json"), "w") as f:
        json.dump({"anchors": anchors}, f)
    print(f"[shots-fusion] anchor frames: {len(anchors)} for {len(picked)} incident(s)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
