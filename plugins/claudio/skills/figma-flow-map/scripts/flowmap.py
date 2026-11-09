#!/usr/bin/env python3
"""Figma flow vs built flow: list a page's frames, shrink thumbnails, check coverage, render the map.

  flowmap.py frames <metadata> [--out frames.json] [--min-width 300] [--min-height 400]
  flowmap.py thumbs <dir> [--width 360]
  flowmap.py check  <spec.json>
  flowmap.py render <spec.json> [out.html]

Stdlib only. See ../SKILL.md for the spec format.
"""
import base64, datetime, html, json, os, re, shutil, subprocess, sys
import xml.etree.ElementTree as ET

KINDS = {"match": ("1:1", "ok"), "state": ("state", "state"), "differs": ("differs", "bad")}


def die(msg):
    sys.exit(f"flowmap: {msg}")


def arg(args, flag, default=None):
    if flag in args:
        i = args.index(flag)
        val = args[i + 1]
        del args[i:i + 2]
        return val
    return default


# ------------------------------------------------------------------ frames
def load_xml(path):
    """Accept raw get_metadata XML, or a saved tool result (JSON) that contains it."""
    raw = open(path, encoding="utf-8").read()
    if raw.lstrip()[:1] in "[{":
        found = []

        def walk(o):
            if isinstance(o, str):
                found.append(o)
            elif isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)

        walk(json.loads(raw))
        raw = next((s for s in found if re.search(r"<(canvas|frame|section)\b", s)), "")
        if not raw:
            die(f"no Figma XML found in {path}")
    start = re.search(r"<(canvas|frame|section|instance|component)\b", raw)
    return ET.fromstring(raw[start.start():] if start else raw)


def texts(el, n=3):
    out = []
    for t in el.iter("text"):
        name = (t.get("name") or "").strip()
        if name and t.get("hidden") != "true":
            out.append(name[:70])
        if len(out) == n:
            break
    return out


def cmd_frames(args):
    out = arg(args, "--out")
    min_w = float(arg(args, "--min-width", 300))
    min_h = float(arg(args, "--min-height", 400))
    if not args:
        die("usage: frames <metadata> [--out frames.json]")
    root = load_xml(args[0])
    frames = []

    def add(el, section, dx=0.0, dy=0.0):
        for c in el:
            x, y = float(c.get("x", 0)) + dx, float(c.get("y", 0)) + dy
            w, h = float(c.get("width", 0)), float(c.get("height", 0))
            if c.tag == "section":  # Figma sections group frames; their children are the screens
                add(c, c.get("name"), x, y)
                continue
            is_screen = c.tag in ("frame", "instance", "component", "component-set") and w >= min_w and h >= min_h
            frames.append(dict(id=c.get("id"), name=c.get("name"), tag=c.tag, x=round(x), y=round(y), w=round(w), h=round(h),
                               role="screen" if is_screen else "label", hidden=c.get("hidden") == "true",
                               section=section, texts=texts(c)))

    add(root, None)
    frames.sort(key=lambda f: (f["y"], f["x"]))
    data = dict(page=root.get("name"), page_id=root.get("id"), frames=frames)
    if out:
        json.dump(data, open(out, "w"), indent=1)

    # Layout for a human (or Claude) to read: rows top to bottom, left to right.
    rows, cur = [], []
    for f in frames:
        if cur and f["y"] > cur[0]["y"] + 300:
            rows.append(cur)
            cur = []
        cur.append(f)
    if cur:
        rows.append(cur)
    screens = [f for f in frames if f["role"] == "screen"]
    print(f"{data['page']} ({data['page_id']}): {len(screens)} screens, {len(frames) - len(screens)} labels/other, "
          f"{sum(f['hidden'] for f in frames)} hidden", file=sys.stderr)
    for i, r in enumerate(rows, 1):
        print(f"\nrow {i} (y~{r[0]['y']})", file=sys.stderr)
        for f in sorted(r, key=lambda f: f["x"]):
            tag = "SCREEN" if f["role"] == "screen" else "label "
            extra = f"  {' | '.join(f['texts'])}" if f["texts"] else ""
            hid = " [hidden]" if f["hidden"] else ""
            print(f"  {tag} {f['id']:<12} x={f['x']:<6} {f['w']}x{f['h']}  {f['name']}{hid}{extra}", file=sys.stderr)
    if not out:
        print(json.dumps(data, indent=1))


# ------------------------------------------------------------------ thumbs
def cmd_thumbs(args):
    width = int(arg(args, "--width", 360))
    if not args:
        die("usage: thumbs <dir> [--width 360]")
    d = args[0]
    sips, ffmpeg = shutil.which("sips"), shutil.which("ffmpeg")
    n = 0
    for name in sorted(os.listdir(d)):
        if not name.lower().endswith(".png"):
            continue
        src, dst = os.path.join(d, name), os.path.join(d, name[:-4] + ".jpg")
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            continue
        if sips:
            w = int(re.search(r"pixelWidth: (\d+)", subprocess.run([sips, "-g", "pixelWidth", src], capture_output=True, text=True).stdout).group(1))
            cmd = [sips, "-s", "format", "jpeg", "-s", "formatOptions", "72"] + (["--resampleWidth", str(width)] if w > width else []) + [src, "--out", dst]
        elif ffmpeg:  # flatten transparency on white, never upscale
            cmd = [ffmpeg, "-loglevel", "error", "-y", "-i", src, "-filter_complex",
                   f"color=white,format=rgb24[bg];[bg][0:v]scale2ref[bg][fg];[bg][fg]overlay=shortest=1,scale='min({width},iw)':-2", "-q:v", "5", dst]
        else:
            print("no sips or ffmpeg: the PNGs will be embedded as they are", file=sys.stderr)
            return
        subprocess.run(cmd, check=True, capture_output=True)
        n += 1
    print(f"{n} thumbnails written in {d}")


# ------------------------------------------------------------------ spec
def load_spec(path):
    spec = json.load(open(path, encoding="utf-8"))
    spec["_dir"] = os.path.dirname(os.path.abspath(path))
    return spec


def all_cards(spec):
    for s in spec.get("sections", []):
        for c in s.get("cards", []):
            yield c
        for lane in s.get("lanes", []):
            for c in lane.get("cards", []):
                yield c


def cmd_check(args, quiet=False):
    if not args:
        die("usage: check <spec.json>")
    spec = load_spec(args[0])
    fpath = os.path.join(spec["_dir"], spec.get("frames", "frames.json"))
    frames = {f["id"]: f for f in json.load(open(fpath))["frames"]}
    screens = {i for i, f in frames.items() if f["role"] == "screen"}
    seen, kinds, problems, warnings = {}, {}, [], []

    def ref(node, where):
        seen.setdefault(node, []).append(where)
        if node not in frames:
            warnings.append(f"{node} ({where}) is not a top-level frame on this page")

    for s in spec.get("sections", []):
        for lane in s.get("lanes", []):
            if lane.get("banner"):
                ref(lane["banner"], f"lane {lane.get('name')}")
    for c in all_cards(spec):
        for f in c.get("figma", []):
            ref(f["node"], c.get("step") or c.get("title"))
            k = f.get("kind", "match")
            if k not in KINDS:
                problems.append(f"{f['node']}: kind {k!r} is not one of {', '.join(KINDS)}")
            k = "not built" if c.get("missing") else k
            kinds[k] = kinds.get(k, 0) + 1
    for ig in spec.get("ignore", []):
        if not ig.get("reason"):
            problems.append(f"ignored {ig['node']} has no reason")
        ref(ig["node"], "ignore")

    unmapped = sorted(screens - set(seen), key=lambda i: (frames[i]["y"], frames[i]["x"]))
    for i in unmapped:
        problems.append(f"unmapped screen {i} \"{frames[i]['name']}\"{' [hidden]' if frames[i]['hidden'] else ''}")
    for node, where in seen.items():
        if len(where) > 1:
            warnings.append(f"{node} is used {len(where)} times: {', '.join(where)}")
    for i in sorted(set(seen) & {i for i, f in frames.items() if f["hidden"]}):
        warnings.append(f"{i} \"{frames[i]['name']}\" is hidden in Figma")

    cards = list(all_cards(spec))
    built_only = [c for c in cards if not c.get("figma")]
    figma_only = [c for c in cards if c.get("missing")]
    differs = [c for c in cards if any(f.get("kind") == "differs" for f in c.get("figma", []))]
    ignored = {i["node"] for i in spec.get("ignore", [])} & screens
    summary = (f"{len(screens)} Figma screens: {len(screens) - len(unmapped) - len(ignored)} mapped "
               f"({', '.join(f'{v} {k}' for k, v in sorted(kinds.items()))}), {len(unmapped)} unmapped, "
               f"{len(ignored)} ignored. Cards: {len(cards)}, {len(built_only)} built only, "
               f"{len(figma_only)} Figma only (not built), {len(differs)} differ.")
    if not quiet:
        for w in warnings:
            print("warn:", w)
        for p in problems:
            print("FAIL:", p)
        print(summary)
    return spec, frames, summary, problems


# ------------------------------------------------------------------ render
CSS = """
:root{--bg:#f6f6fb;--card:#fff;--ink:#14163a;--muted:#5d6180;--line:#e2e3ef;--accent:#3b3fd8;--ok:#0f7b55;--okbg:#e3f5ec;--st:#5d6180;--stbg:#eceef5;--warn:#8a5a00;--warnbg:#fff3d6;--bad:#b3261e;--badbg:#fde7e4;--banner:#2f6fe4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1020;--card:#191b30;--ink:#eceefe;--muted:#a3a7c7;--line:#2c2f4a;--accent:#9497ff;--ok:#6fe0b0;--okbg:#123528;--st:#b9bcd6;--stbg:#262942;--warn:#ffd27a;--warnbg:#3a2d0c;--bad:#ff9d94;--badbg:#3d1714;--banner:#4d86f0}}
:root[data-theme="dark"]{--bg:#0f1020;--card:#191b30;--ink:#eceefe;--muted:#a3a7c7;--line:#2c2f4a;--accent:#9497ff;--ok:#6fe0b0;--okbg:#123528;--st:#b9bcd6;--stbg:#262942;--warn:#ffd27a;--warnbg:#3a2d0c;--bad:#ff9d94;--badbg:#3d1714;--banner:#4d86f0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px 16px 64px}
header{max-width:1100px}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:36px 0 2px}h3{font-size:13px;margin:8px 0 4px}
.sub{color:var(--muted);margin:0 0 12px;max-width:820px}.legend{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0;color:var(--muted)}
.summary{font-weight:600;margin:8px 0}
.row{display:flex;align-items:flex-start;gap:6px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity}
.arrow{align-self:center;color:var(--muted);font-size:18px;flex:none}
.card{flex:none;width:min(280px,82vw);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;scroll-snap-align:start}
.card.wide{width:min(420px,88vw)}.card.built-only{border-color:var(--warn);background:var(--warnbg)}.card.figma-only{border:2px dashed var(--bad);background:var(--badbg)}
.frames{display:flex;gap:8px}.frame{flex:1 1 0;min-width:0;color:inherit;display:block;text-decoration:none}
.frame img{width:100%;height:220px;object-fit:cover;object-position:top;border-radius:8px;border:1px solid var(--line);display:block;background:#fff;cursor:zoom-in}
.frame.built img{border-style:dashed;border-color:var(--accent)}
.frame img:hover,.frame img:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.flabel{display:block;font-size:11px;margin-top:4px;color:var(--muted)}.fid{font-size:10px;color:var(--muted);opacity:.8}.fid:hover{color:var(--accent)}
.chip{display:inline-block;font-size:10px;font-weight:600;border-radius:999px;padding:0 6px;margin-right:4px}
.chip.ok{color:var(--ok);background:var(--okbg)}.chip.state{color:var(--st);background:var(--stbg)}.chip.warn{color:var(--warn);background:var(--warnbg)}.chip.bad{color:var(--bad);background:var(--badbg)}.chip.built{color:var(--accent);background:var(--stbg)}
code{font-size:11px;background:var(--stbg);padding:1px 5px;border-radius:4px}.path{display:block;font-size:11px;color:var(--muted);margin-top:3px;word-break:break-all}
.path a{color:inherit}.note{font-size:11.5px;margin:6px 0 0;color:var(--warn)}.figma-only .note{color:var(--bad)}
.noframe{height:220px;display:grid;place-items:center;border:1px dashed var(--warn);border-radius:8px;color:var(--warn);font-weight:600;text-align:center;padding:8px}
.marker{font-size:11px;font-weight:600;color:var(--accent);margin-bottom:6px}
.lane{margin-top:14px}.banner{display:inline-flex;gap:10px;align-items:baseline;background:var(--banner);color:#fff;border-radius:8px;padding:6px 12px;text-decoration:none;margin-bottom:4px}
.banner span{opacity:.85;font-size:12px}
dialog{border:0;border-radius:12px;padding:12px;max-width:96vw;max-height:94vh;background:var(--card);color:var(--ink)}
dialog::backdrop{background:rgb(0 0 0/.6)}.zoom{display:flex;gap:12px;overflow:auto;max-height:84vh}
.zoom figure{margin:0;flex:none}.zoom img{display:block;width:min(390px,80vw);height:auto;border:1px solid var(--line);border-radius:8px}
.zoom figcaption{font-size:12px;color:var(--muted);margin-top:4px}.zbar{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-weight:600}
.zbar button{font:inherit;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:2px 10px;cursor:pointer}
"""

JS = """
const d=document.getElementById('zoom');
document.addEventListener('click',e=>{const img=e.target.closest('.frame img');if(!img)return;e.preventDefault();
const card=img.closest('.card');d.querySelector('.ztitle').textContent=card.dataset.title;const z=d.querySelector('.zoom');z.textContent='';
card.querySelectorAll('.frame').forEach(f=>{const fig=document.createElement('figure');const i=document.createElement('img');i.src=f.querySelector('img').src;i.alt=f.querySelector('img').alt;
const cap=document.createElement('figcaption');cap.textContent=f.querySelector('.flabel').textContent;fig.append(i,cap);z.append(fig)});d.showModal()});
d.querySelector('button').addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close()});
"""


def cmd_render(args):
    if not args:
        die("usage: render <spec.json> [out.html]")
    spec, frames, summary, problems = cmd_check(args[:1], quiet=True)
    out = args[1] if len(args) > 1 else os.path.join(spec["_dir"], "flow-map.html")
    e = html.escape
    fig = spec.get("figma", {})
    fig_base = f"https://www.figma.com/design/{fig.get('fileKey', '')}/{fig.get('fileName', 'f')}?node-id="
    base_url = spec.get("app", {}).get("baseUrl", "").rstrip("/")
    missing_imgs = []

    def data_uri(rel_or_node, folder=None):
        cands = ([os.path.join(spec["_dir"], folder, rel_or_node.replace(":", "-") + ext) for ext in (".jpg", ".png")]
                 if folder else [os.path.join(spec["_dir"], rel_or_node)])
        if not folder and rel_or_node.lower().endswith(".png"):
            cands.insert(0, os.path.join(spec["_dir"], rel_or_node[:-4] + ".jpg"))
        for p in cands:
            if os.path.exists(p):
                mime = "image/jpeg" if p.endswith(".jpg") else "image/png"
                return f"data:{mime};base64," + base64.b64encode(open(p, "rb").read()).decode()
        missing_imgs.append(rel_or_node)
        return ""

    def figma_frame(f):
        chip, cls = KINDS.get(f.get("kind", "match"), KINDS["match"])
        link = fig_base + f["node"].replace(":", "-")
        return (f'<div class="frame"><img src="{data_uri(f["node"], "figma")}" alt="Figma: {e(f.get("label", ""))}" tabindex="0">'
                f'<span class="flabel"><span class="chip {cls}">{chip}</span>Figma: {e(f.get("label", ""))}</span>'
                f'<a class="fid" href="{link}" target="_blank" rel="noopener">{e(f["node"])} ↗</a></div>')

    def built_frame(b):
        b = {"src": b} if isinstance(b, str) else b
        return (f'<div class="frame built"><img src="{data_uri(b["src"])}" alt="Built: {e(b.get("label", "screenshot"))}" tabindex="0">'
                f'<span class="flabel"><span class="chip built">built</span>{e(b.get("label", "Built"))}</span></div>')

    def card_html(c):
        frs = [figma_frame(f) for f in c.get("figma", [])] + [built_frame(b) for b in c.get("built", [])]
        if not c.get("figma"):
            frs.insert(0, '<div class="noframe">No Figma frame</div>')
        cls = "card"
        if c.get("missing"):
            cls += " figma-only"
        elif not c.get("figma"):
            cls += " built-only"
        if len(frs) > 2 or (c.get("built") and len(frs) > 1):
            cls += " wide"
        path = c.get("path", "")
        path_html = (f'<a href="{e(base_url + path)}" target="_blank" rel="noopener">{e(path)}</a>' if base_url and path.startswith("/") else e(path))
        status = '<span class="chip bad">not built</span>' if c.get("missing") else ('<span class="chip warn">built only</span>' if not c.get("figma") else "")
        return (f'<article class="{cls}" data-title="{e(c.get("title") or c.get("step", ""))}">'
                + (f'<div class="marker">{e(c["marker"])}</div>' if c.get("marker") else "")
                + f'<div class="frames">{"".join(frs)}</div><h3>{status}{e(c.get("title", ""))}</h3>'
                + (f'<code>{e(c["step"])}</code>' if c.get("step") else "")
                + (f'<span class="path">{path_html}</span>' if path else "")
                + (f'<p class="note">{e(c["note"])}</p>' if c.get("note") else "") + "</article>")

    def row(cards):
        return '<div class="row">' + '<span class="arrow" aria-hidden="true">→</span>'.join(card_html(c) for c in cards) + "</div>"

    body = []
    for s in spec.get("sections", []):
        part = f'<section><h2>{e(s.get("title", ""))}</h2>' + (f'<p class="sub">{e(s["intro"])}</p>' if s.get("intro") else "")
        if s.get("cards"):
            part += row(s["cards"])
        for lane in s.get("lanes", []):
            name = f'<strong>{e(lane.get("name", ""))}</strong>' + (f'<span>{e(lane["tag"])}</span>' if lane.get("tag") else "")
            banner = (f'<a class="banner" href="{fig_base}{lane["banner"].replace(":", "-")}" target="_blank" rel="noopener">{name}</a>'
                      if lane.get("banner") else f'<span class="banner">{name}</span>')
            part += (f'<div class="lane">{banner}' + (f'<p class="sub">{e(lane["intro"])}</p>' if lane.get("intro") else "")
                     + row(lane.get("cards", [])) + "</div>")
        body.append(part + "</section>")

    ignored = spec.get("ignore", [])
    if ignored:
        body.append('<section><h2>Figma frames left out of the map</h2><ul class="sub">' + "".join(
            f'<li><a href="{fig_base}{i["node"].replace(":", "-")}" target="_blank" rel="noopener">{e(frames.get(i["node"], {}).get("name", i["node"]))}</a>: {e(i.get("reason", ""))}</li>'
            for i in ignored) + "</ul></section>")
    warn = ('<p class="summary" style="color:var(--bad)">Coverage check failed: ' + e("; ".join(problems)) + "</p>") if problems else ""
    title = spec.get("title", "Flow map vs Figma")
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(spec.get("pageTitle", "Flow vs Figma Map"))}</title><style>{CSS}</style></head><body>
<header><h1>{e(title)}</h1>{f'<p class="sub">{e(spec["intro"])}</p>' if spec.get("intro") else ""}
<p class="summary">{e(summary)}</p>{warn}
<div class="legend"><span><span class="chip ok">1:1</span>built screen matches this frame</span><span><span class="chip state">state</span>same screen, another state</span><span><span class="chip bad">differs</span>built screen differs (see note)</span><span><span class="chip warn">built only</span>no Figma frame</span><span><span class="chip bad">not built</span>Figma frame with no built screen</span><span><span class="chip built">built</span>screenshot of the real flow</span></div>
<p class="sub">Click a picture to compare a card's images at full height. The frame id opens it in Figma. Generated {datetime.date.today().isoformat()}.</p></header>
{"".join(body)}
<dialog id="zoom" aria-label="Compare"><div class="zbar"><span class="ztitle"></span><button type="button">Close</button></div><div class="zoom"></div></dialog>
<script>{JS}</script></body></html>"""
    open(out, "w", encoding="utf-8").write(page)
    print(summary)
    if missing_imgs:
        print(f"warn: {len(missing_imgs)} images missing: {', '.join(missing_imgs[:8])}")
    if problems:
        print(f"FAIL: {len(problems)} coverage problems (run check)")
    print(f"wrote {out} ({len(page) // 1024} KB)")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("frames", "thumbs", "check", "render"):
        print(__doc__)
        sys.exit(2)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "check":
        _, _, _, problems = cmd_check(args)
        sys.exit(1 if problems else 0)
    {"frames": cmd_frames, "thumbs": cmd_thumbs, "render": cmd_render}[cmd](args)


if __name__ == "__main__":
    main()
