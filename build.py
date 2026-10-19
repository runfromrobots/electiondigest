#!/usr/bin/env python3
"""Build the Midterm Digest site from the raw daily issues in source/.

Each file in source/ is one issue, named NN_YYYY-MM-DD.html (issue number,
issue date). Every issue was generated with its own one-off layout, so this
script normalizes them into one shared structure, extracts the seat-change
score tables, and writes:

    index.html          home page (score chart, latest issue, archive)
    issues/NN.html      one page per issue

Usage:
    pip install beautifulsoup4
    python3 build.py
"""

import datetime as dt
import html
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"
OUT_ISSUES = ROOT / "issues"
YEAR = 2026
ELECTION_DAY = dt.date(2026, 11, 3)

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
          "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12}
DATE_RE = re.compile(r"\b(Sept?|Oct|Nov|Aug)[a-z]*\.?\s+(\d{1,2})\b", re.I)
SCORE_RE = re.compile(r"^[+\-−–]?\d+$")

SECTION_NAMES = [
    ("race dev", "Race developments", "races"),
    ("polling", "Polling & forecasts", "polling"),
    ("administration", "Election administration & security", "admin"),
    ("worth sharing", "Worth sharing", "sharing"),
    ("seat-change", "Seat-change score", "score"),
]

# Purely decorative pieces of the original layouts (mini bar charts, rules).
DECOR = {"bars", "bar", "bar-col", "bar-val", "bar-day", "bar-track", "bar-fill",
         "bar-mid", "sparkbar", "trend-bar", "trend-col", "stick", "section-rule",
         "rule", "dot", "score-bar-track", "score-bar-fill", "dateline", "toc",
         "masthead-meta", "corrected-flag"}

# Original class token -> normalized class.
CLASS_MAP = [
    ({"share-card", "share-box", "share", "callout", "worth-sharing"}, "share"),
    ({"item", "card"}, "item"),
    ({"tag", "pill", "item-tag", "card-tag"}, "tag"),
    ({"item-title", "headline", "race-label", "race-name", "item-race"}, "item-title"),
    ({"item-head", "item-top"}, "item-head"),
    ({"src", "source-line", "item-source", "cite", "meta", "tags"}, "src"),
    ({"flag", "gap-note", "caveat", "flag-note", "correction-box"}, "note flag"),
    ({"lede", "standfirst", "notice", "intro"}, "lede"),
    ({"deck", "secnote", "section-sub", "section-desc", "block-sub", "section-note"}, "deck"),
    ({"methodology", "method-note", "score-methodology"}, "method"),
    ({"trend", "trend-line", "trend-note", "trend-summary", "trend-text"}, "trend"),
    ({"empty-note", "note", "empty", "note-box", "plain-note", "none-note",
      "muted-note", "follow", "score-note", "stat-note", "asof"}, "note"),
    ({"pitch"}, "pitch"),
    ({"quote"}, "quote"),
    ({"score-summary", "score-hero", "score-today", "score-banner"}, "stats"),
    ({"stat"}, "stat"),
    ({"label", "stat-label", "score-label", "score-today-label", "trend-label"}, "stat-label"),
    ({"value", "val", "stat-value", "score-num", "score-today-value", "big", "num"}, "stat-value"),
    ({"score-desc", "cap"}, "stat-desc"),
    ({"poll-grid"}, "poll-grid"),
    ({"poll-card", "poll-table"}, "poll-card"),
    ({"race"}, "poll-race"),
    ({"bar-row", "poll-row"}, "poll-row"),
    ({"name", "cand"}, "poll-name"),
    ({"pct"}, "poll-pct"),
]
PARTY = {"d": "dem", "dem": "dem", "r": "rep", "rep": "rep", "gop": "rep"}


def esc(s):
    return html.escape(s, quote=True)


def parse_date(text):
    m = DATE_RE.search(text)
    if not m:
        return None
    month = MONTHS.get(m.group(1).lower().rstrip("."))
    if not month:
        return None
    return dt.date(YEAR, month, int(m.group(2)))


def parse_score(text):
    t = text.strip().replace("−", "-").replace("–", "-")
    if not SCORE_RE.match(t):
        return None
    return int(t)


def section_name(raw):
    t = re.sub(r"^[^A-Za-z]+", "", raw).strip()
    low = t.lower()
    for key, name, slug in SECTION_NAMES:
        if key in low:
            return name, slug
    return t, re.sub(r"[^a-z0-9]+", "-", low).strip("-")


def tokens(el):
    return set(el.get("class") or [])


def long_date(d):
    return f"{d:%A}, {d:%B} {d.day}, {d.year}"


def short_date(d):
    return f"{d:%b} {d.day}"


def fmt_score(n):
    return f"+{n}" if n > 0 else ("0" if n == 0 else f"−{abs(n)}")


def score_class(n):
    return "pos" if n > 0 else ("neg" if n < 0 else "zero")


def clean_issue(raw):
    """Return (headline, sections, footer_html, score_rows) for one raw issue."""
    soup = BeautifulSoup(raw, "html.parser")

    for t in soup(["style", "script", "link", "meta", "title", "head", "svg", "noscript", "hr"]):
        t.decompose()
    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()
    for el in soup.find_all(attrs={"aria-hidden": "true"}):
        el.decompose()
    for el in soup.find_all(True):
        if el.parent is not None and tokens(el) & DECOR:
            el.decompose()
    for el in soup.find_all("nav"):
        el.decompose()

    # Masthead: keep a custom headline, drop the rest.
    headline = None
    mast = None
    for el in soup.find_all(True):
        if el.name == "header" or any("masthead" in c for c in tokens(el)):
            mast = el
            break
    h1 = (mast.find("h1") if mast else None) or soup.find("h1")
    if h1:
        text = h1.get_text(" ", strip=True)
        if not re.search(r"digest|midterm|issue|wire|count|dispatch|ledger|2026|days to", text, re.I):
            headline = text
    if mast:
        mast.decompose()
    elif h1:
        h1.decompose()

    footer_html = ""
    foot = soup.find("footer")
    if foot:
        footer_html = " ".join(str(c) for c in foot.contents).strip()
        foot.decompose()

    # Rebuild the Sabato-style ratings list so its spans read as text.
    for ul in soup.find_all("ul", class_="ratings-list"):
        for li in ul.find_all("li"):
            parts = [s.get_text(strip=True) for s in li.find_all("span")]
            if len(parts) == 4:
                li.clear()
                li.append(f"{parts[0]}: {parts[1]} → {parts[3]}")

    secs = [s for s in soup.find_all(True)
            if s.name == "section" or (s.name == "div" and "section" in tokens(s))]
    # Anything before the first section is an intro (lede, score banner).
    intro = []
    if secs:
        first = secs[0]
        for sib in list(first.find_previous_siblings()):
            if isinstance(sib, Tag) and sib.get_text(strip=True):
                intro.insert(0, sib.extract())

    sections = []
    score_rows = []
    for sec in secs:
        title_el = (sec.find(class_="section-label") or sec.find("h2")
                    or sec.find(class_=re.compile(r"sec-title|section-title|block-title")))
        name, slug = ("Notes", "notes")
        if title_el:
            name, slug = section_name(title_el.get_text(" ", strip=True))
            parent = title_el.parent
            if parent is not sec and any(("head" in c or "label" in c) for c in tokens(parent)):
                parent.decompose()
            else:
                title_el.decompose()
        for h in sec.find_all("h2"):
            h.name = "h3"
            h["class"] = ["subhead"]
        normalize(sec, soup)
        if slug == "score":
            score_rows.extend(extract_scores(sec))
        body = "".join(str(c) for c in sec.contents).strip()
        sections.append({"name": name, "slug": slug, "html": body, "soup": sec})

    intro_html = ""
    if intro:
        wrap = soup.new_tag("div")
        for el in intro:
            wrap.append(el)
        normalize(wrap, soup)
        intro_html = "".join(str(c) for c in wrap.contents).strip()

    if footer_html:
        fs = BeautifulSoup(footer_html, "html.parser")
        normalize(fs, fs)
        footer_html = str(fs)

    return headline, intro_html, sections, footer_html, score_rows


def normalize(root, soup):
    """Strip one-off styling and map each element onto the shared classes."""
    for table in root.find_all("table"):
        normalize_table(table, soup)
    # Some issues list stories as <ul class="items"><li>...</li></ul>.
    for ul in root.find_all("ul", class_="items"):
        for li in ul.find_all("li", recursive=False):
            li.name = "div"
            li["class"] = ["item"]
        ul.name = "div"
        ul.attrs = {}

    for el in root.find_all(True):
        if el.name in ("table", "thead", "tbody", "tr", "td", "th", "caption"):
            keep = el.get("class") if el.name in ("tr", "td") else None
            el.attrs = {"class": keep} if keep else {}
            continue
        tk = tokens(el)
        new = []
        for keys, cls in CLASS_MAP:
            if tk & keys:
                new = cls.split()
                break
        if "trend-box" in tk:
            new = ["stats"] if el.find(class_="stat") else ["trend"]
        if "stats" in new and el.name == "span":
            new = ["stat-value"]
        if "flag" in tk and el.name == "span":
            new = ["flag-label"]
        if el.name == "p" and "item-head" in tk:
            new = ["item-title"]
        if new and new[0] == "tag":
            party = next((PARTY[t] for t in tk if t in PARTY), None)
            if party:
                new.append(party)
        if el.name == "h3":
            new = new or ["item-title"]

        href = el.get("href") if el.name == "a" else None
        is_open = el.name == "details" and el.has_attr("open")
        el.attrs = {}
        if new:
            el["class"] = new
        if href:
            el["href"] = href
            if href.startswith("http"):
                el["target"] = "_blank"
                el["rel"] = "noopener"
        if is_open:
            el["open"] = ""

    # Drop wrappers that no longer carry anything.
    for el in root.find_all(["div", "span"]):
        if not el.get_text(strip=True) and not el.find(["table", "img"]):
            el.decompose()


def normalize_table(table, soup):
    rows = table.find_all("tr")
    header = rows[0] if rows and rows[0].find("th") else None
    drop = set()
    if header:
        for i, th in enumerate(header.find_all(["th", "td"])):
            if th.get_text(strip=True).lower() in ("", "lean", "scale", "7-day bar"):
                drop.add(i)
    for tr in rows:
        cells = tr.find_all(["th", "td"], recursive=False)
        for i in sorted(drop, reverse=True):
            if i < len(cells):
                cells[i].decompose()
        today = any("today" in c for c in tokens(tr)) or any(
            any("today" in c for c in tokens(td)) for td in tr.find_all("td"))
        tr.attrs = {"class": ["today"]} if today else {}
        for td in tr.find_all("td", recursive=False):
            text = td.get_text(" ", strip=True)
            n = parse_score(text)
            if n is not None:
                td.attrs = {"class": ["num", score_class(n)]}
                td.string = fmt_score(n)
            elif parse_date(text) and len(text) < 30:
                td.attrs = {"class": ["date"]}
            else:
                td.attrs = {}
    wrap = soup.new_tag("div")
    wrap["class"] = ["table-wrap"]
    table.wrap(wrap)


def extract_scores(sec):
    out = []
    for tr in sec.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        d = parse_date(cells[0].get_text(" ", strip=True))
        n = None
        for c in cells[1:]:
            n = parse_score(c.get_text(" ", strip=True))
            if n is not None:
                break
        if d and n is not None:
            note = cells[-1].get_text(" ", strip=True)
            out.append((d, n, note))
    return out


def plain(html_fragment):
    return BeautifulSoup(html_fragment, "html.parser").get_text(" ", strip=True)


def truncate(text, limit=170):
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def item_titles(sections, limit=None):
    """Lead lines for an issue: item titles, or the first sentence of each item."""
    out = []
    for s in sections:
        if s["slug"] == "score":
            continue
        for item in s["soup"].find_all(class_=["item", "share"]):
            t = item.find(class_="item-title")
            if t:
                text = " ".join(s.strip() for s in t.find_all(string=True)
                                if not s.find_parent(class_="tag") and s.strip())
            else:
                p = item.find("p")
                if not p:
                    continue
                for tag in p.find_all(class_="tag"):
                    tag.extract()
                text = p.get_text(" ", strip=True)
                text = re.split(r"(?<!\bSen\.)(?<!\bRep\.)(?<!\bGov\.)(?<!\bSt\.)(?<!\bDr\.)"
                                r"(?<!\bMr\.)(?<!\bU\.S\.)(?<=[.!?])\s+(?=[A-Z])", text, maxsplit=1)[0]
            text = truncate(text, 150)
            if text and text not in out:
                out.append(text)
    return out[:limit] if limit else out


# ---------------------------------------------------------------- templates

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}assets/styles.css">
<script>try{{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}}catch(e){{}}</script>
</head>
<body class="{body_class}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="{root}index.html"><span class="brand-mark" aria-hidden="true"></span>Midterm Digest</a>
    <nav class="site-nav" aria-label="Site">
      <a href="{root}index.html#score">Score</a>
      <a href="{root}map.html">Map</a>
      <a href="{root}index.html#latest">Latest</a>
      <a href="{root}index.html#archive">Archive</a>
      <button class="theme-toggle" type="button" aria-label="Toggle dark mode"><span aria-hidden="true">◐</span></button>
    </nav>
  </div>
</header>
"""

FOOT = """<footer class="site-footer">
  <div class="wrap">
    <p>A daily, nonpartisan read on the 2026 U.S. midterms. Sources include AP, Reuters, Cook Political Report, Sabato's Crystal Ball, Inside Elections, official election offices and court dockets, linked inline in every issue.</p>
    <p>Compiled automatically. Verify anything important against the primary source.</p>
  </div>
</footer>
<script src="{root}assets/app.js"></script>
</body>
</html>
"""


def render_issue(issue, prev_issue, next_issue):
    d = issue["date"]
    days = (ELECTION_DAY - d).days
    score = issue["day_score"]
    chip = ""
    if score is not None:
        chip = f'<span class="chip {score_class(score)}">Day score {fmt_score(score)}</span>'
    toc = "".join(f'<a href="#{s["slug"]}">{esc(s["name"])}</a>' for s in issue["sections"])
    body = []
    if issue["intro"]:
        body.append(f'<div class="intro">{issue["intro"]}</div>')
    for i, s in enumerate(issue["sections"], 1):
        body.append(
            f'<section class="issue-section" id="{s["slug"]}">'
            f'<h2><span class="sec-num">{i:02d}</span>{esc(s["name"])}</h2>'
            f'{s["html"]}</section>')
    pager = ['<nav class="pager" aria-label="Issues">']
    if prev_issue:
        pager.append(f'<a class="prev" href="{prev_issue["file"]}"><span>← Previous</span>'
                     f'Issue {prev_issue["n"]} · {short_date(prev_issue["date"])}</a>')
    else:
        pager.append("<span></span>")
    if next_issue:
        pager.append(f'<a class="next" href="{next_issue["file"]}"><span>Next →</span>'
                     f'Issue {next_issue["n"]} · {short_date(next_issue["date"])}</a>')
    pager.append("</nav>")
    headline = issue["headline"] or "Midterm Election Digest"
    out = HEAD.format(
        title=f"Issue {issue['n']}, {short_date(d)} · Midterm Digest",
        description=esc(truncate(issue["summary"], 150)),
        root="../", body_class="issue-page")
    out += f"""<main id="main" class="wrap issue">
  <div class="issue-mast">
    <p class="eyebrow"><a href="../index.html#archive">Archive</a> / Issue No. {issue['n']}</p>
    <h1>{esc(headline)}</h1>
    <p class="issue-meta"><time datetime="{d.isoformat()}">{long_date(d)}</time><span>{days} days to Election Day</span>{chip}</p>
  </div>
  <nav class="issue-toc" aria-label="Sections">{toc}</nav>
  <article class="issue-body">
    {''.join(body)}
  </article>
  {f'<aside class="issue-foot">{issue["footer"]}</aside>' if issue["footer"] else ''}
  {''.join(pager)}
</main>
"""
    out += FOOT.format(root="../")
    return out


def render_index(issues, series, stats):
    latest = issues[-1]
    lead = latest["titles"][:4]
    lead_html = "".join(f"<li>{esc(t)}</li>" for t in lead)
    rows = []
    for iss in reversed(issues):
        s = iss["day_score"]
        chip = (f'<span class="chip {score_class(s)}">{fmt_score(s)}</span>'
                if s is not None else '<span class="chip none">n/a</span>')
        search = esc(" ".join([iss["summary"]] + iss["titles"]).lower())
        rows.append(
            f'<li class="arch-row" data-search="{search}">'
            f'<a href="{iss["file"]}">'
            f'<span class="arch-no">No. {iss["n"]}</span>'
            f'<time class="arch-date" datetime="{iss["date"].isoformat()}">{iss["date"]:%a}, {short_date(iss["date"])}</time>'
            f'<span class="arch-lead">{esc(iss["summary"])}</span>'
            f'{chip}</a></li>')
    data = {
        "series": series,
        "election": ELECTION_DAY.isoformat(),
        "latest": latest["date"].isoformat(),
    }
    table_rows = "".join(
        f'<tr><td>{esc(p["label"])}</td><td class="num {score_class(p["score"])}">{fmt_score(p["score"])}</td>'
        f'<td>{p["total"]:+d}</td><td>{esc(p["note"])}</td></tr>'
        for p in series if p["score"] is not None)

    out = HEAD.format(
        title="Midterm Digest · 2026 midterm tracker",
        description="Daily nonpartisan digest of the 2026 U.S. midterms, with a running seat-change score built from confirmed race-rating changes.",
        root="", body_class="home")
    out += f"""<main id="main">
  <section class="score-panel" id="score" aria-labelledby="score-title">
    <div class="wrap">
      <div class="panel-head">
        <div class="panel-title">
          <p class="eyebrow">2026 U.S. midterms · Seat-change score</p>
          <h1 id="score-title">Race ratings have moved <span class="pos-text">{stats['total']:+d}</span> toward Democrats since Sept 16</h1>
          <p class="hero-dek">A daily, nonpartisan digest of Senate, House and governor races. Every confirmed rating change from Cook, Sabato and Inside Elections scores one point.</p>
        </div>
        <div class="countdown" data-election="{ELECTION_DAY.isoformat()}">
          <span class="count-num" id="days-left">{(ELECTION_DAY - dt.date.today()).days}</span>
          <span class="count-label">days to Election Day<br><b>Tuesday, Nov 3</b></span>
        </div>
      </div>
      <div class="chart-bar">
        <div class="seg" role="group" aria-label="Chart view">
          <button type="button" class="seg-btn is-on" data-mode="daily" aria-pressed="true">Daily score</button>
          <button type="button" class="seg-btn" data-mode="total" aria-pressed="false">Running total</button>
        </div>
      </div>

      <figure class="chart-fig">
        <div class="chart" id="chart" role="img" aria-label="Bar chart of the daily seat-change score from {series[0]['label']} to {series[-1]['label']}. Net {stats['total']:+d}."></div>
        <div class="chart-tip" id="chart-tip" hidden></div>
        <figcaption class="chart-cap">
          <span><i class="sw dem" aria-hidden="true"></i>Toward Democrats</span>
          <span><i class="sw rep" aria-hidden="true"></i>Toward Republicans</span>
          <span><i class="sw zero" aria-hidden="true"></i>No confirmed change</span>
          <span class="cap-note">Hover or tap a bar for what drove it. Click to open that day's issue.</span>
        </figcaption>
        <details class="chart-table">
          <summary>View as table</summary>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Score</th><th>Running total</th><th>What drove it</th></tr></thead><tbody>{table_rows}</tbody></table></div>
        </details>
      </figure>

      <div class="tiles">
        <div class="tile"><span class="tile-label">Net score</span><span class="tile-value">{stats['total']:+d}</span><span class="tile-sub">{stats['days']} days tracked</span></div>
        <div class="tile"><span class="tile-label">Moves toward Democrats</span><span class="tile-value"><i class="sw dem" aria-hidden="true"></i>{stats['dem']}</span><span class="tile-sub">+1 each</span></div>
        <div class="tile"><span class="tile-label">Moves toward Republicans</span><span class="tile-value"><i class="sw rep" aria-hidden="true"></i>{stats['rep']}</span><span class="tile-sub">−1 each</span></div>
        <div class="tile"><span class="tile-label">Days with movement</span><span class="tile-value">{stats['active']}</span><span class="tile-sub">of {stats['days']}</span></div>
      </div>


      <a class="map-cta" href="map.html"><span>See where these moves happened, state by state</span><b>Open the map →</b></a>

      <div class="how" aria-labelledby="how-title">
        <h3 id="how-title">How the score works</h3>
        <div class="how-grid">
          <ol class="rules">
            <li><span><b class="pos-text">+1</b> for each race a nonpartisan rater moves toward Democrats.</span></li>
            <li><span><b class="neg-text">−1</b> for each race moved toward Republicans.</span></li>
            <li><span><b>One point per race,</b> however many notches it moves. Solid R to Likely R counts the same as Lean R to Toss-up.</span></li>
            <li><span><b>Raters that count:</b> Cook Political Report, Sabato's Crystal Ball and Inside Elections. Confirmed changes only.</span></li>
            <li><span><b>Never counted:</b> polls, fundraising, endorsements, the generic ballot, forecast odds or court rulings.</span></li>
            <li><span><b>No double counting.</b> A second rater making the same move on the same race adds nothing. Moves found late are scored on the day they surface, so batches arrive in lumps.</span></li>
          </ol>
          <div class="examples">
            <div class="example">
              <p class="ex-head"><span>Oct 14</span><b class="pos-text">+4</b></p>
              <p class="ex-desc">Cook moves four governor races in one batch</p>
              <ul class="ex-moves">
                <li><span>Alaska</span><span>Toss Up → Lean D</span><b class="pos-text">+1</b></li>
                <li><span>Nebraska</span><span>Solid R → Likely R</span><b class="pos-text">+1</b></li>
                <li><span>Oklahoma</span><span>Solid R → Likely R</span><b class="pos-text">+1</b></li>
                <li><span>Vermont</span><span>Solid R → Likely R</span><b class="pos-text">+1</b></li>
              </ul>
              <div class="ex-bar" aria-hidden="true"><i class="dem"></i><i class="dem"></i><i class="dem"></i><i class="dem"></i></div>
            </div>
            <div class="example">
              <p class="ex-head"><span>Sept 16</span><b class="neg-text">−1</b></p>
              <p class="ex-desc">Cook moves one Senate race the other way</p>
              <ul class="ex-moves">
                <li><span>New Hampshire</span><span>Lean D → Toss-up</span><b class="neg-text">−1</b></li>
              </ul>
              <div class="ex-bar" aria-hidden="true"><i class="rep"></i></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="latest wrap" id="latest" aria-labelledby="latest-title">
    <div class="latest-card">
      <div>
        <p class="eyebrow">Latest · Issue No. {latest['n']} · {long_date(latest['date'])}</p>
        <h2 id="latest-title">{esc(latest['headline'] or "Today's digest")}</h2>
        <ul class="lead-list">{lead_html}</ul>
      </div>
      <a class="btn" href="{latest['file']}">Read Issue {latest['n']} →</a>
    </div>
  </section>

  <section class="archive wrap" id="archive" aria-labelledby="archive-title">
    <div class="archive-head">
      <h2 id="archive-title">Archive <span class="count">{len(issues)} issues</span></h2>
      <label class="search"><span class="visually-hidden">Search issues</span>
        <input type="search" id="archive-search" placeholder="Search issues, e.g. Kansas" autocomplete="off">
      </label>
    </div>
    <ol class="arch-list" id="arch-list">{''.join(rows)}</ol>
    <p class="arch-empty" id="arch-empty" hidden>No issues match that search.</p>
  </section>
</main>
<script id="digest-data" type="application/json">{json.dumps(data)}</script>
"""
    out += FOOT.format(root="")
    return out


D3 = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"
TOPOJSON = "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"


def render_map(moves):
    out = HEAD.format(
        title="Rating changes by state · Midterm Digest",
        description="Map of every confirmed 2026 race-rating change tracked by the Midterm Digest: where ratings moved, where each race started and where it stands now.",
        root="", body_class="map-page")
    out += """<main id="main">
  <section class="map-panel wrap" aria-labelledby="map-title">
    <p class="eyebrow">Seat-change map</p>
    <h1 id="map-title">Where the ratings have moved</h1>
    <p class="hero-dek">Every rating change the digest has itemized, placed by state. Compare where each race started with where it stands now, or switch to the shift view to see which way the map is leaning.</p>

    <div class="map-controls">
      <div class="seg" role="group" aria-label="Race type" id="type-seg">
        <button type="button" class="seg-btn is-on" data-type="sen" aria-pressed="true">Senate</button>
        <button type="button" class="seg-btn" data-type="gov" aria-pressed="false">Governor</button>
        <button type="button" class="seg-btn" data-type="house" aria-pressed="false">House</button>
        <button type="button" class="seg-btn" data-type="all" aria-pressed="false">All races</button>
      </div>
      <div class="seg" role="group" aria-label="Map view" id="view-seg">
        <button type="button" class="seg-btn" data-view="before" aria-pressed="false">Before</button>
        <button type="button" class="seg-btn is-on" data-view="now" aria-pressed="true">Now</button>
        <button type="button" class="seg-btn" data-view="shift" aria-pressed="false">Shift</button>
      </div>
    </div>

    <div class="map-layout">
      <figure class="map-fig">
        <div class="map" id="map" role="img" aria-label="Map of the United States showing race-rating changes by state"></div>
        <div class="chart-tip" id="map-tip" hidden></div>
        <figcaption class="map-legend" id="map-legend"></figcaption>
      </figure>
      <aside class="map-side" id="map-side" aria-live="polite"></aside>
    </div>

    <div class="outlook" id="outlook"></div>

    <details class="chart-table" id="race-table-wrap">
      <summary>All tracked races as a table</summary>
      <div class="table-wrap"><table id="race-table"><thead><tr><th>Race</th><th>Before</th><th>Now</th><th>Moves</th><th>Path</th></tr></thead><tbody></tbody></table></div>
    </details>

    <p class="map-note" id="map-note"></p>
  </section>
</main>
"""
    out += f'<script id="moves-data" type="application/json">{json.dumps(moves)}</script>\n'
    out += f'<script src="{D3}"></script>\n<script src="{TOPOJSON}"></script>\n'
    out += '<script src="assets/map.js"></script>\n'
    out += FOOT.format(root="")
    return out


def build():
    files = sorted(SRC.glob("*.html"))
    issues = []
    scores = {}  # date -> (score, note, reported_by_issue); later issues win
    for f in files:
        m = re.match(r"(\d+)_(\d{4}-\d{2}-\d{2})\.html$", f.name)
        if not m:
            continue
        n, d = int(m.group(1)), dt.date.fromisoformat(m.group(2))
        headline, intro, sections, footer, rows = clean_issue(f.read_text(encoding="utf-8"))
        for (sd, sv, note) in rows:
            scores[sd] = (sv, note, n)
        titles = item_titles(sections)
        summary = titles[0] if titles else truncate(plain(sections[0]["html"]) if sections else "")
        issues.append({"n": n, "date": d, "file": f"issues/{n}.html", "headline": headline,
                       "intro": intro, "sections": sections, "footer": footer,
                       "titles": titles, "summary": summary})
    issues.sort(key=lambda i: i["n"])
    by_date = {i["date"]: i for i in issues}
    for iss in issues:
        s = scores.get(iss["date"])
        iss["day_score"] = s[0] if s else None

    # Continuous daily series from the first scored day to the latest issue.
    start = min(scores)
    end = max(max(scores), issues[-1]["date"])
    series, total, d = [], 0, start
    while d <= end:
        s = scores.get(d)
        if s:
            total += s[0]
        iss = by_date.get(d)
        series.append({
            "date": d.isoformat(), "label": short_date(d),
            "score": s[0] if s else None, "total": total,
            "note": s[1] if s else "Not tracked",
            "issue": f"issues/{iss['n']}.html" if iss else None,
            "n": iss["n"] if iss else None,
        })
        d += dt.timedelta(days=1)
    vals = [p["score"] for p in series if p["score"] is not None]
    stats = {"total": sum(vals), "dem": sum(v for v in vals if v > 0),
             "rep": -sum(v for v in vals if v < 0), "active": sum(1 for v in vals if v),
             "days": len(vals)}

    OUT_ISSUES.mkdir(exist_ok=True)
    for i, iss in enumerate(issues):
        prev_i = issues[i - 1] if i > 0 else None
        next_i = issues[i + 1] if i + 1 < len(issues) else None
        page = render_issue(iss, prev_i, next_i)
        # Issue pages live one level down; pager links are siblings.
        page = page.replace('href="issues/', 'href="')
        (OUT_ISSUES / f"{iss['n']}.html").write_text(page, encoding="utf-8")
    (ROOT / "index.html").write_text(render_index(issues, series, stats), encoding="utf-8")
    moves = json.loads((ROOT / "data" / "moves.json").read_text(encoding="utf-8"))
    (ROOT / "map.html").write_text(render_map(moves), encoding="utf-8")
    mapped = sum((1 if m["scored"] else 0) for m in moves["moves"])
    print(f"Map: {len(moves['moves'])} itemized moves ({mapped} scored), "
          f"{sum(u['count'] for u in moves['unitemized'])} unitemized")
    print(f"Built {len(issues)} issues, {len(vals)} scored days, net {stats['total']:+d}")


if __name__ == "__main__":
    build()
