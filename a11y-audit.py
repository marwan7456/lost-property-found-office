"""Automated accessibility audit used for the evaluation report (run: node server.js, then python3 testing/a11y-audit.py out/).
Usage: python3 -I audit.py <outdir>"""
import sys, json, os, re
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BASE = "http://localhost:3000/"

CHECK_JS = r"""
() => {
  const issues = [];
  const vis = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && !el.closest('[hidden]') && (r.width > 0 || r.height > 0); };
  // duplicate ids
  const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id]||0)+1);
  Object.entries(ids).filter(([k,v]) => v>1).forEach(([k]) => issues.push('duplicate id: '+k));
  // aria-describedby / labelledby refs
  document.querySelectorAll('[aria-describedby],[aria-labelledby]').forEach(e => {
    ['aria-describedby','aria-labelledby'].forEach(a => (e.getAttribute(a)||'').split(/\s+/).filter(Boolean)
      .forEach(id => { if (!document.getElementById(id)) issues.push(a+' broken ref '+id); }));
  });
  // unlabelled controls
  document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(c => {
    if (!vis(c)) return;
    const lab = c.labels && c.labels.length; const aria = c.getAttribute('aria-label') || c.getAttribute('aria-labelledby');
    if (!lab && !aria) issues.push('unlabelled control #'+c.id);
  });
  // buttons/links without names
  document.querySelectorAll('button,a[href]').forEach(b => { if (vis(b) && !b.textContent.trim() && !b.getAttribute('aria-label')) issues.push('empty name '+b.outerHTML.slice(0,60)); });
  // heading order
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map(h => +h.tagName[1]);
  let prev = 0; hs.forEach(l => { if (prev && l > prev+1) issues.push('heading skip h'+prev+'->h'+l); prev = l; });
  if (hs.filter(l => l===1).length !== 1) issues.push('h1 count '+hs.filter(l=>l===1).length);
  // landmarks
  ['header','nav','main','footer'].forEach(t => { if (!document.querySelector(t)) issues.push('missing landmark '+t); });
  if (!document.documentElement.lang) issues.push('no lang');
  // contrast
  const parse = c => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
  const lum = ([r,g,b]) => { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const bgOf = el => { while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c.length<4 || c[3] > 0) return c.slice(0,3); el = el.parentElement; } return [255,255,255]; };
  let minRatio = 99, checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!vis(el) || el.closest('.visually-hidden,[aria-hidden=true]')) continue;
    const s = getComputedStyle(el); const fg = parse(s.color).slice(0,3); const bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    checked++; minRatio = Math.min(minRatio, ratio);
    if (ratio < (large ? 3 : 4.5)) issues.push('contrast '+ratio.toFixed(2)+' "'+n.textContent.trim().slice(0,30)+'"');
  }
  // reflow
  const hscroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  if (hscroll) issues.push('horizontal scroll '+document.documentElement.scrollWidth+'>'+document.documentElement.clientWidth);
  return { issues, title: document.title, textNodes: checked, minRatio: +minRatio.toFixed(2) };
}
"""

FOCUS_JS = r"""
() => { const el = document.activeElement; if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  return { tag: el.tagName.toLowerCase(), id: el.id, text: (el.textContent||el.value||'').trim().slice(0,40),
           outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, shadow: s.boxShadow !== 'none' }; }
"""

results = {}
announcements = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.expose_function("logAnnounce", lambda t: announcements.append(t))
    page.add_init_script("""
      document.addEventListener('DOMContentLoaded', () => {
        const r = document.getElementById('announcer');
        new MutationObserver(() => { if (r.textContent) window.logAnnounce(r.textContent); })
          .observe(r, {childList:true, characterData:true, subtree:true});
      });""")

    def audit(name, widths=(1280, 640, 320), shot=None, shot_w=1280, full=False):
        res = {}
        for w in widths:
            page.set_viewport_size({"width": w, "height": 800})
            page.wait_for_timeout(150)
            res[w] = page.evaluate(CHECK_JS)
            if shot and w == shot_w:
                page.screenshot(path=f"{OUT}/{shot}.png", full_page=full)
        page.set_viewport_size({"width": 1280, "height": 800})
        results[name] = res
        print(name, {w: (r['issues'], r['minRatio']) for w, r in res.items()})

    def focused():
        return page.evaluate(FOCUS_JS)

    # --- Sign in, empty
    page.goto(BASE); page.wait_for_selector("#signin-title:focus", timeout=5000)
    audit("Sign in (empty)")
    # submit empty via keyboard
    page.focus("#signin-button"); page.keyboard.press("Enter"); page.wait_for_timeout(200)
    fe = focused(); print("focus after failed sign-in:", fe)
    results["focus_after_signin_error"] = fe
    page.fill("#password", "ab"); page.keyboard.press("Enter"); page.wait_for_timeout(200)
    audit("Sign in (errors)", shot="01_signin_errors")
    page.fill("#staffName", "Marwan"); page.fill("#password", "desk1")
    page.check("#role-supervisor")
    page.focus("#signin-button"); page.keyboard.press("Enter")
    page.wait_for_selector("#home-title:focus", timeout=5000); page.wait_for_timeout(600)
    results["focus_after_signin"] = focused()
    audit("Home", shot="02_home", full=True)

    # --- Keyboard tab walk on home: every stop must show a focus indicator
    page.focus("body"); page.evaluate("document.activeElement.blur()")
    stops, seen = [], set()
    page.keyboard.press("Tab")
    for i in range(60):
        f = focused()
        if not f: break
        key = (f["tag"], f["id"], f["text"])
        if key in seen and len(stops) > 3: break
        seen.add(key); stops.append(f); page.keyboard.press("Tab")
    results["home_tab_stops"] = stops
    print("home tab stops:", len(stops), "without visible focus:", [s for s in stops if not (s["outline"] or s["shadow"])])

    # --- Log form
    page.goto(BASE + "#/log"); page.wait_for_selector("#log-title:focus")
    audit("Log an item (empty)")
    page.click("#log-submit"); page.wait_for_timeout(200)
    results["focus_after_log_error"] = focused()
    page.check("#kind-lost"); page.click("#log-submit"); page.wait_for_timeout(200)
    audit("Log an item (errors)", shot="03_log_errors", full=True)
    # summary link moves focus to field
    page.click("#log-errors a >> nth=0"); page.wait_for_timeout(100)
    results["focus_after_summary_link"] = focused()
    # conditional fields
    page.select_option("#category", "Other"); page.select_option("#locationChoice", "elsewhere")
    results["conditional_visible"] = page.evaluate("[!document.getElementById('otherCategory-group').hidden, !document.getElementById('locationOther-group').hidden]")
    page.select_option("#category", "Phones and electronics"); page.select_option("#locationChoice", "Library")
    page.fill("#title", "Blue iPhone 13 in clear case")
    page.fill("#owner", "Sara Ahmed"); page.fill("#contact", "sara@example")
    page.click("#log-submit"); page.wait_for_timeout(200)
    results["contact_error"] = page.inner_text("#contact-error")
    page.fill("#contact", "sara@example.com")
    page.click("#log-submit"); page.wait_for_selector("#log-success:focus", timeout=5000)
    results["focus_after_save"] = focused()
    results["kept_after_save"] = page.evaluate("({kind: document.querySelector('input[name=kind]:checked').value, place: document.getElementById('locationChoice').value, title: document.getElementById('title').value})")
    audit("Log an item (saved)", shot="04_log_saved", full=False)

    # --- Records
    page.goto(BASE + "#/records"); page.wait_for_selector("#records-body tr", timeout=5000); page.wait_for_timeout(300)
    audit("Records (results)", shot="05_records")
    page.click("#records-head [data-sort=title]"); page.wait_for_timeout(300)
    results["focus_after_sort"] = focused()
    results["aria_sort"] = page.evaluate("[...document.querySelectorAll('#records-head th')].map(t=>t.getAttribute('aria-sort'))")
    page.screenshot(path=f"{OUT}/06_records_sorted.png")
    page.set_viewport_size({"width": 320, "height": 640}); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/09_records_320.png")
    page.set_viewport_size({"width": 1280, "height": 800})
    page.fill("#f-search", "zzzz-nothing"); page.wait_for_timeout(1200)
    audit("Records (empty state)", shot="07_records_empty")
    results["count_text_empty"] = page.inner_text("#result-count")
    page.click("#empty-clear"); page.wait_for_timeout(400)
    results["focus_after_clear"] = focused()
    results["count_text"] = page.inner_text("#result-count")

    # --- Record detail
    page.click("#records-body th a >> nth=0"); page.wait_for_selector("#record-title:focus", timeout=5000)
    results["detail_title"] = page.title()
    audit("Record detail (open)")
    radios = page.locator("#update-form input[type=radio]")
    for i in range(radios.count()):
        if radios.nth(i).get_attribute("value") == "Returned":
            radios.nth(i).check()
    page.fill("#returnedTo", "")
    page.click("#update-form button[type=submit]"); page.wait_for_timeout(300)
    audit("Record detail (return errors)", shot="08_record_errors", full=True)

    # 200% zoom equivalent screenshot on log form
    page.goto(BASE + "#/log"); page.wait_for_selector("#log-title:focus")
    page.set_viewport_size({"width": 640, "height": 800})
    page.screenshot(path=f"{OUT}/10_log_200pct.png")
    browser.close()

results["announcements"] = announcements
json.dump(results, open(f"{OUT}/audit.json", "w"), indent=1)
print("ANNOUNCEMENTS:", announcements)
for k in ["focus_after_signin_error","focus_after_signin","focus_after_log_error","focus_after_summary_link","conditional_visible","contact_error","focus_after_save","kept_after_save","focus_after_sort","aria_sort","count_text_empty","focus_after_clear","count_text","detail_title"]:
    print(k, "=>", results.get(k))
