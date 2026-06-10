# Sample CCTV clips

Clips are **not** checked into git (see `.gitignore`). The smoke test either:

- generates a synthetic 6-second `lavfi` clip via ffmpeg in `bootstrap/04_seed_samples.sh` (default), or
- uploads a clip you provide via `SAMPLE_LOCAL=/path/to/clip.mp4 bash bootstrap/04_seed_samples.sh`.

For more realistic demos, public datasets like UCF-Crime or AVSS work well; download a small subset (clips < 5 MB each), drop them in this directory, and run:

```bash
for f in tests/samples/*.mp4; do
  SAMPLE_LOCAL="$f" bash bootstrap/04_seed_samples.sh
done
```

Do not commit clips you do not have rights to redistribute.
