# Renders edge-tests/page.html in headless Chromium, reads pixels around each test element,
# and writes index.html with the results filled in.
import json, io, sys
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
page_html = (HERE / 'page.html').read_text()

RED, BLUE, WHITE = (229, 72, 77), (59, 130, 246), (255, 255, 255)
def near(px, ref, tol=40):
    return all(abs(a - b) <= tol for a, b in zip(px[:3], ref))
def name(px):
    return 'red' if near(px, RED) else 'blue' if near(px, BLUE) else 'white' if near(px, WHITE) else f'other{px[:3]}'

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 900}, device_scale_factor=1)
    page.set_content('<!doctype html><meta charset=utf-8>' + page_html)
    page.wait_for_timeout(300)
    version = browser.version
    shot = Image.open(io.BytesIO(page.screenshot(full_page=True))).convert('RGB')
    rects = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.t')].map(e => {
        const r = e.getBoundingClientRect(); return [e.id, {x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height}]; }))""")
    browser.close()

def sample(r, dx, dy):
    return name(shot.getpixel((int(r['x'] + dx), int(r['y'] + dy))))

raw, results = {}, {}
for cid, r in rects.items():
    midy = r['h'] / 2
    s = {
        'centre': sample(r, r['w'] / 2, midy),
        'edge_in': sample(r, 4, midy),          # 4px inside the left edge
        'out3': sample(r, -3, midy),            # 3px outside the left edge
    }
    raw[cid] = s
    if cid.startswith('c3'):
        drawn = s['centre'] == 'blue' and s['edge_in'] == 'red'
        if cid == 'c3d':
            ok = drawn and s['out3'] == 'red'
            results[cid] = {'kind': 'ok' if ok else 'no', 'text': '그려짐, 바깥 6px도 보임' if ok else f'다름 ({s})'}
        else:
            results[cid] = {'kind': 'ok' if drawn else 'no', 'text': '그려짐' if drawn else f'안 그려짐 ({s})'}
    else:
        visible = s['out3'] == 'red'
        results[cid] = {'kind': 'info', 'text': '바깥이 보임' if visible else '바깥이 잘림'}

print('Chromium', version)
print(json.dumps(raw, indent=1))
(HERE / 'index.html').write_text(page_html.replace('/*RESULTS*/{}', json.dumps(results, ensure_ascii=False)))
