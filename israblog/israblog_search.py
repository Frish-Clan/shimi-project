#!/usr/bin/env python3
"""
Israblog archive search & selective download.

Works on the Arquivo.pt "EAWP19" crawl of Israblog that is hosted on
archive.org as items named  portuguese-web-archive-EAWP19-2019-00NN.
Each item holds WARC files + one CDX index (.cdx.gz).

The CDX index contains only URLs (no text), so the flow is:

  1. index     - stream the .cdx.gz, keep only Israblog HTML pages and
                 extract blog id / year / month from the URL -> local TSV.
  2. search    - for each blog, fetch only its 2003-2005 pages straight out
                 of the WARC using HTTP Range requests (a few KB each, never
                 the whole multi-GB WARC), and look for your search terms.
  3. download  - for the matching blogs, fetch all their 2003-2005 pages and
                 save them as readable HTML + a small .warc.gz per blog
                 (openable in https://replayweb.page).

Only the Python standard library is used.

Examples
--------
  python israblog_search.py index \
      --cdx https://archive.org/download/portuguese-web-archive-EAWP19-2019-0028/portuguese-web-archive-EAWP19-2019-0028.cdx.gz \
      --out index.tsv

  python israblog_search.py search --index index.tsv --term "חיפה" --term "טכניון" \
      --mode all --out matches.tsv

  python israblog_search.py download --index index.tsv --matches matches.tsv --out-dir blogs
  python israblog_search.py download --index index.tsv --blog 12345 --out-dir blogs
"""

from __future__ import annotations

import argparse
import csv
import gzip
import html
import io
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

DEFAULT_YEARS = (2003, 2005)
DEFAULT_CHARSET = "windows-1255"  # Israblog served Hebrew in cp1255
USER_AGENT = "israblog-archive-research/1.0 (personal research script)"

# CDX field letters -> our names (see https://iipc.github.io/warc-specifications/specifications/cdx-format/cdx-2015/)
CDX_LETTERS = {
    "N": "urlkey", "b": "timestamp", "a": "url", "m": "mime", "s": "status",
    "k": "digest", "r": "redirect", "M": "meta", "S": "length", "V": "offset",
    "g": "filename",
}
DEFAULT_CDX_FIELDS = "N b a m s k r M S V g".split()

INDEX_COLUMNS = ["item", "filename", "offset", "length", "timestamp", "status",
                 "mime", "blog", "year", "month", "kind", "url"]


# --------------------------------------------------------------------------- #
# URL helpers
# --------------------------------------------------------------------------- #
def item_from_url(url: str) -> str | None:
    m = re.search(r"archive\.org/download/([^/]+)/", url)
    return m.group(1) if m else None


def parse_israblog_url(url: str) -> dict | None:
    """Extract blog id / year / month / page kind from an Israblog URL.

    Known shapes (all on israblog.nana10.co.il / israblog.co.il):
      blogread.asp?blog=123&year=2004&month=5      -> monthly archive page
      blogread.asp?blog=123&blogcode=456789        -> single post
      blogread.asp?blog=123                        -> blog front page
      comments.asp?blog=123&user=...               -> comments, etc.
    """
    if "israblog" not in url.lower():
        return None
    parts = urllib.parse.urlsplit(url)
    q = {k.lower(): v[0] for k, v in urllib.parse.parse_qs(parts.query).items() if v}
    blog = q.get("blog") or q.get("blogid")
    if not blog or not blog.isdigit():
        return None
    year = q.get("year", "")
    month = q.get("month", "")
    page = parts.path.rsplit("/", 1)[-1].lower()
    if year and month:
        kind = "month"
    elif "blogcode" in q:
        kind = "post"
    elif page.startswith("blogread") and len(q) == 1:
        kind = "front"
    else:
        kind = page.split(".")[0] or "other"
    return {"blog": blog, "year": year if year.isdigit() else "",
            "month": month if month.isdigit() else "", "kind": kind}


# --------------------------------------------------------------------------- #
# 1. index
# --------------------------------------------------------------------------- #
def open_cdx(src: str):
    if re.match(r"https?://", src):
        req = urllib.request.Request(src, headers={"User-Agent": USER_AGENT})
        resp = urllib.request.urlopen(req, timeout=120)
        raw = resp
    else:
        raw = open(src, "rb")
    if src.endswith(".gz"):
        raw = gzip.GzipFile(fileobj=raw)
    return io.TextIOWrapper(raw, encoding="utf-8", errors="replace")


def cmd_index(args):
    y0, y1 = args.years
    written = scanned = 0
    out_exists = os.path.exists(args.out) and args.append
    with open(args.out, "a" if args.append else "w", newline="", encoding="utf-8") as fo:
        w = csv.writer(fo, delimiter="\t")
        if not out_exists:
            w.writerow(INDEX_COLUMNS)
        for src in args.cdx:
            item = args.item or item_from_url(src)
            if not item:
                sys.exit(f"Cannot infer archive.org item for {src}; pass --item")
            fields = DEFAULT_CDX_FIELDS
            t0 = time.time()
            for line in open_cdx(src):
                if line.startswith(" CDX") or line.startswith("CDX"):
                    fields = line.split()[1:]
                    continue
                scanned += 1
                if scanned % 1_000_000 == 0:
                    print(f"  {scanned:,} lines scanned, {written:,} kept "
                          f"({time.time() - t0:.0f}s)", file=sys.stderr)
                if "israblog" not in line:
                    continue
                vals = line.rstrip("\n").split(" ")
                if len(vals) != len(fields):
                    continue
                rec = {CDX_LETTERS.get(f, f): v for f, v in zip(fields, vals)}
                if "length" not in rec or "offset" not in rec:
                    sys.exit("CDX has no compressed-length (S) / offset (V) fields")
                if rec.get("status") not in ("200", "-") or "html" not in rec.get("mime", ""):
                    continue
                info = parse_israblog_url(rec["url"])
                if not info:
                    continue
                if info["year"] and not (y0 <= int(info["year"]) <= y1):
                    continue  # dated page outside the requested years
                w.writerow([item, rec["filename"], rec["offset"], rec["length"],
                            rec["timestamp"], rec.get("status", ""), rec.get("mime", ""),
                            info["blog"], info["year"], info["month"], info["kind"], rec["url"]])
                written += 1
    print(f"Done: scanned {scanned:,} CDX lines, wrote {written:,} rows to {args.out}",
          file=sys.stderr)


def load_index(path: str, blogs: set[str] | None = None) -> dict[str, list[dict]]:
    """Return {blog_id: [rows]} with duplicate captures of a URL collapsed to the newest."""
    best: dict[str, dict] = {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if blogs and row["blog"] not in blogs:
                continue
            prev = best.get(row["url"])
            if prev is None or row["timestamp"] > prev["timestamp"]:
                best[row["url"]] = row
    by_blog: dict[str, list[dict]] = {}
    for row in best.values():
        by_blog.setdefault(row["blog"], []).append(row)
    return by_blog


# --------------------------------------------------------------------------- #
# WARC record fetching / parsing
# --------------------------------------------------------------------------- #
class Fetcher:
    def __init__(self, warc_dir: str | None, retries: int = 4, delay: float = 0.0):
        self.warc_dir = warc_dir
        self.retries = retries
        self.delay = delay
        self._lock = threading.Lock()

    def raw(self, row: dict) -> bytes:
        off, ln = int(row["offset"]), int(row["length"])
        if self.warc_dir:
            with open(os.path.join(self.warc_dir, row["filename"]), "rb") as f:
                f.seek(off)
                return f.read(ln)
        url = f"https://archive.org/download/{row['item']}/{row['filename']}"
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT, "Range": f"bytes={off}-{off + ln - 1}"})
        for attempt in range(self.retries + 1):
            try:
                if self.delay:
                    time.sleep(self.delay)
                with urllib.request.urlopen(req, timeout=60) as r:
                    if r.status != 206:
                        raise RuntimeError(f"server ignored Range request (HTTP {r.status})")
                    return r.read()
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == self.retries:
                    raise
                wait = 2 ** (attempt + 1)
                print(f"  retry {attempt + 1} for {row['url']} in {wait}s ({e})", file=sys.stderr)
                time.sleep(wait)
        raise RuntimeError("unreachable")


def gunzip_member(data: bytes) -> bytes:
    return zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data)


def dechunk(body: bytes) -> bytes:
    out, i = bytearray(), 0
    while i < len(body):
        j = body.find(b"\r\n", i)
        if j < 0:
            break
        size = int(body[i:j].split(b";")[0].strip() or b"0", 16)
        if size == 0:
            break
        out += body[j + 2:j + 2 + size]
        i = j + 2 + size + 2
    return bytes(out)


def parse_headers(block: bytes) -> dict[str, str]:
    h = {}
    for line in block.split(b"\r\n")[1:]:
        if b":" in line:
            k, v = line.split(b":", 1)
            h[k.strip().lower().decode("latin-1")] = v.strip().decode("latin-1")
    return h


def parse_warc_response(record: bytes) -> tuple[dict, bytes]:
    """record = one decompressed WARC 'response' record -> (http_headers, body bytes)."""
    warc_head, _, rest = record.partition(b"\r\n\r\n")
    http_head, _, body = rest.partition(b"\r\n\r\n")
    h = parse_headers(http_head)
    if "chunked" in h.get("transfer-encoding", "").lower():
        body = dechunk(body)
    if h.get("content-encoding", "").lower() in ("gzip", "x-gzip"):
        try:
            body = gunzip_member(body)
        except zlib.error:
            pass
    return h, body.rstrip(b"\r\n")


def decode_html(headers: dict, body: bytes) -> str:
    cs = None
    m = re.search(r"charset=([\w-]+)", headers.get("content-type", ""), re.I)
    if m:
        cs = m.group(1)
    else:
        m = re.search(rb"charset=[\"']?([\w-]+)", body[:4000], re.I)
        if m:
            cs = m.group(1).decode("ascii", "ignore")
    for enc in (cs, DEFAULT_CHARSET, "utf-8"):
        if not enc:
            continue
        try:
            return body.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode(DEFAULT_CHARSET, errors="replace")


TAG_RE = re.compile(r"<script.*?</script>|<style.*?</style>|<[^>]+>", re.S | re.I)
HEB_NIKUD = re.compile(r"[֑-ׇ]")


def html_to_text(s: str) -> str:
    s = html.unescape(TAG_RE.sub(" ", s))
    s = HEB_NIKUD.sub("", s)
    return re.sub(r"\s+", " ", s)


def years_in_text(text: str) -> set[int]:
    return {int(y) for y in re.findall(r"\b\d{1,2}[/.]\d{1,2}[/.](\d{4})\b", text)}


def fetch_page(fetcher: Fetcher, row: dict) -> tuple[bytes, str, str]:
    """-> (raw gzip member, decoded html, plain text)"""
    raw = fetcher.raw(row)
    headers, body = parse_warc_response(gunzip_member(raw))
    page = decode_html(headers, body)
    return raw, page, html_to_text(page)


# --------------------------------------------------------------------------- #
# 2. search
# --------------------------------------------------------------------------- #
@dataclass
class Matcher:
    terms: list[str]
    mode: str
    regex: bool

    def __post_init__(self):
        flags = re.I
        self.pats = [re.compile(t if self.regex else re.escape(HEB_NIKUD.sub("", t)), flags)
                     for t in self.terms]

    def hits(self, text: str) -> list[str]:
        return [t for t, p in zip(self.terms, self.pats) if p.search(text)]

    def ok(self, hits: list[str]) -> bool:
        return bool(hits) and (self.mode == "any" or len(set(hits)) == len(self.terms))


def search_rows(rows: list[dict], y0: int, y1: int, max_pages: int) -> list[dict]:
    """Pages of one blog worth searching: dated pages in range first, then undated posts."""
    order = {"month": 0, "post": 1, "front": 2}
    rows = [r for r in rows if r["kind"] in order]
    rows.sort(key=lambda r: (order[r["kind"]], r["year"], r["month"].zfill(2)))
    return rows[:max_pages] if max_pages else rows


def search_blog(blog, rows, fetcher, matcher, y0, y1):
    found: set[str] = set()
    pages: list[str] = []
    errors = 0
    for row in rows:
        try:
            _, _, text = fetch_page(fetcher, row)
        except Exception as e:  # noqa: BLE001
            errors += 1
            print(f"  ! blog {blog}: {row['url']}: {e}", file=sys.stderr)
            continue
        if not row["year"]:
            yrs = years_in_text(text)
            if yrs and not any(y0 <= y <= y1 for y in yrs):
                continue  # undated URL whose content is outside 2003-2005
        h = matcher.hits(text)
        if h:
            found.update(h)
            pages.append(row["url"])
            if matcher.ok(list(found)):
                return blog, sorted(found), pages, errors
    return blog, (sorted(found) if matcher.ok(list(found)) else []), pages, errors


def cmd_search(args):
    y0, y1 = args.years
    blogs = set(args.blog) if args.blog else None
    by_blog = load_index(args.index, blogs)
    matcher = Matcher(args.term, args.mode, args.regex)
    fetcher = Fetcher(args.warc_dir, delay=args.delay)

    done = set()
    if os.path.exists(args.out):  # resume support
        with open(args.out, encoding="utf-8") as f:
            done = {r["blog"] for r in csv.DictReader(f, delimiter="\t")}
    progress_file = args.out + ".searched"
    if os.path.exists(progress_file):
        done |= set(open(progress_file, encoding="utf-8").read().split())

    todo = [(b, search_rows(r, y0, y1, args.max_pages)) for b, r in by_blog.items() if b not in done]
    todo = [(b, r) for b, r in todo if r]
    print(f"{len(by_blog):,} blogs in index, {len(todo):,} to search "
          f"({sum(len(r) for _, r in todo):,} pages max)", file=sys.stderr)

    new_file = not os.path.exists(args.out)
    with open(args.out, "a", newline="", encoding="utf-8") as fo, \
            open(progress_file, "a", encoding="utf-8") as fp, \
            ThreadPoolExecutor(max_workers=args.workers) as ex:
        w = csv.writer(fo, delimiter="\t")
        if new_file:
            w.writerow(["blog", "terms", "example_pages"])
        futs = [ex.submit(search_blog, b, r, fetcher, matcher, y0, y1) for b, r in todo]
        n_match = 0
        for i, fut in enumerate(as_completed(futs), 1):
            blog, terms, pages, errors = fut.result()
            if terms:
                n_match += 1
                w.writerow([blog, ",".join(terms), " ".join(pages[:5])])
                fo.flush()
                print(f"  MATCH blog {blog}: {terms}  {pages[0]}", file=sys.stderr)
            if not errors:
                fp.write(blog + "\n")
                fp.flush()
            if i % 100 == 0:
                print(f"  {i:,}/{len(todo):,} blogs searched, {n_match} matches", file=sys.stderr)
    print(f"Done. {n_match} matching blogs -> {args.out}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# 3. download
# --------------------------------------------------------------------------- #
def safe_name(row: dict) -> str:
    q = urllib.parse.urlsplit(row["url"]).query
    name = re.sub(r"[^\w.=-]+", "_", q)[:150] or "index"
    if row["year"]:
        return f"{row['year']}-{row['month'].zfill(2)}__{name}.html"
    return f"{row['kind']}__{name}.html"


def cmd_download(args):
    y0, y1 = args.years
    blogs = set(args.blog or [])
    if args.matches:
        with open(args.matches, encoding="utf-8") as f:
            blogs |= {r["blog"] for r in csv.DictReader(f, delimiter="\t")}
    if not blogs:
        sys.exit("Nothing to download: pass --matches and/or --blog")
    by_blog = load_index(args.index, blogs)
    fetcher = Fetcher(args.warc_dir, delay=args.delay)

    for blog in sorted(blogs):
        rows = sorted(by_blog.get(blog, []), key=lambda r: (r["year"], r["month"].zfill(2), r["url"]))
        if not rows:
            print(f"blog {blog}: not in index", file=sys.stderr)
            continue
        bdir = os.path.join(args.out_dir, f"blog_{blog}")
        os.makedirs(bdir, exist_ok=True)
        saved = 0
        listing = []

        def work(row):
            return row, fetch_page(fetcher, row)

        with open(os.path.join(bdir, f"blog_{blog}.warc.gz"), "wb") as warc, \
                ThreadPoolExecutor(max_workers=args.workers) as ex:
            for fut in as_completed([ex.submit(work, r) for r in rows]):
                try:
                    row, (raw, page, text) = fut.result()
                except Exception as e:  # noqa: BLE001
                    print(f"  ! {e}", file=sys.stderr)
                    continue
                if not row["year"] and not args.all_years:
                    yrs = years_in_text(text)
                    if yrs and not any(y0 <= y <= y1 for y in yrs):
                        continue
                warc.write(raw)  # concatenated gzip members = valid .warc.gz
                fname = safe_name(row)
                with open(os.path.join(bdir, fname), "w", encoding="utf-8") as f:
                    f.write(re.sub(r"charset=[\w-]+", "charset=utf-8", page, count=1, flags=re.I))
                listing.append((fname, row["url"], row["timestamp"]))
                saved += 1
        listing.sort()
        with open(os.path.join(bdir, "index.html"), "w", encoding="utf-8") as f:
            f.write(f'<html dir="rtl"><meta charset="utf-8"><title>Israblog {blog}</title>'
                    f"<h1>Israblog blog {blog}</h1><ul>")
            for fname, url, ts in listing:
                f.write(f'<li><a href="{html.escape(fname)}">{html.escape(fname)}</a> '
                        f"<small>{html.escape(url)} (captured {ts})</small></li>")
            f.write("</ul></html>")
        print(f"blog {blog}: saved {saved} pages -> {bdir}", file=sys.stderr)


# --------------------------------------------------------------------------- #
def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def years(s):
        a, _, b = s.partition("-")
        return int(a), int(b or a)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--years", type=years, default=DEFAULT_YEARS,
                        help="year range of blog posts, e.g. 2003-2005 (default)")

    fetch = argparse.ArgumentParser(add_help=False)
    fetch.add_argument("--index", required=True, help="TSV produced by the 'index' command")
    fetch.add_argument("--warc-dir", help="read WARCs from this local folder instead of archive.org")
    fetch.add_argument("--workers", type=int, default=6, help="parallel requests (be polite)")
    fetch.add_argument("--delay", type=float, default=0.0, help="seconds to sleep before each request")
    fetch.add_argument("--blog", action="append", help="restrict to blog id (repeatable)")

    s = sub.add_parser("index", parents=[common], help="filter a CDX index to Israblog pages")
    s.add_argument("--cdx", action="append", required=True, help="CDX .cdx.gz URL or local path (repeatable)")
    s.add_argument("--item", help="archive.org item id (only needed for local CDX files)")
    s.add_argument("--out", default="index.tsv")
    s.add_argument("--append", action="store_true", help="append to an existing index (several items)")
    s.set_defaults(func=cmd_index)

    s = sub.add_parser("search", parents=[common, fetch], help="search blog text for terms")
    s.add_argument("--term", action="append", required=True, help="search term (repeatable)")
    s.add_argument("--mode", choices=["any", "all"], default="any")
    s.add_argument("--regex", action="store_true", help="treat terms as regular expressions")
    s.add_argument("--max-pages", type=int, default=0, help="max pages to read per blog (0 = all)")
    s.add_argument("--out", default="matches.tsv")
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("download", parents=[common, fetch], help="download matching blogs")
    s.add_argument("--matches", help="matches.tsv from the 'search' command")
    s.add_argument("--out-dir", default="blogs")
    s.add_argument("--all-years", action="store_true", help="keep undated pages outside the year range")
    s.set_defaults(func=cmd_download)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
