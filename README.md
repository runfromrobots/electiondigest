# Midterm Digest

A static site that archives the daily 2026 midterm election digest and charts
the seat-change score. No framework and no build step for hosting: the
generated `index.html` and `issues/` are plain HTML.

## Structure

```
index.html          home: seat-change score chart, how scoring works, latest issue, archive
map.html            state map: where ratings moved, before vs now, shift arrows (generated)
issues/NN.html      one page per issue (generated)
data/moves.json     every itemized rating change (race, rater, from, to, date, issue)
assets/styles.css   shared styles, light and dark themes
assets/app.js       chart, theme toggle, countdown, archive search
assets/map.js       map rendering (d3 + us-atlas from jsDelivr)
source/             raw daily issues as published, named NN_YYYY-MM-DD.html
build.py            normalizes source/ into issues/, regenerates index.html and map.html
```

## Adding a new issue

1. Save the day's digest HTML to `source/` as `NN_YYYY-MM-DD.html`
   (for example `37_2026-10-20.html`).
2. Rebuild:

   ```
   pip install beautifulsoup4
   python3 build.py
   ```

3. If the issue reports itemized rating changes, add them to `data/moves.json`
   (one entry per race, with the rater's own from/to labels). Moves reported
   only as a total go under `unitemized`.

The build reads each issue's seat-change table. When several issues report the
same date, the most recent issue wins, so later corrections carry through to the
chart.

## Preview locally

```
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Notes

- Issue 1 isn't in the archive. No published copy of it was found.
- Oct 7 had two editions ("Midterm Wire" and a later "Midterm Election
  Digest" run). The archive keeps the later one, whose +5 score is the figure
  every subsequent issue carries forward.
- The map uses `data/moves.json`, which is curated by hand from the issues.
  Cook's 15-race House batch from Sept 25 was reported only as a total, so it
  counts toward the score but can't be placed on the map.
