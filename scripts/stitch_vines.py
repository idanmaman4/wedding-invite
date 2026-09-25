"""Stitch the slices from capture_vines.mjs into the phone vine strips.

Writes public/media/vine_<width>_{left,right,top}.webp and updates
src/vineSets.json with each capture's page height. Needs Pillow.

    python scripts/stitch_vines.py <tmp-dir>
"""
import json
import sys

from PIL import Image

d = sys.argv[1]
meta = json.load(open(d + '/meta.json'))
old = {s['width']: s for s in json.load(open('src/vineSets.json'))}
sets = []
for m in meta:
    W, docH, S = m['W'], m['docH'], 3
    SS = m.get('ss', S)  # the capture's render scale (supersampled when > 3)
    full = Image.new('RGBA', (W * SS, docH * SS), (0, 0, 0, 0))
    for sl in m['slices']:
        full.paste(Image.open(sl['f']).convert('RGBA'), (0, sl['y'] * SS))
    if SS != S:
        # Downscale in premultiplied alpha: resizing straight RGBA drags the
        # colour of fully transparent pixels into leaf edges (dark fringes).
        full = full.convert('RGBa').resize((W * S, docH * S), Image.LANCZOS).convert('RGBA')
    side, top = old[W]['side'], old[W]['top']
    opts = dict(quality=90, alpha_quality=100, method=6)
    full.crop((0, 0, side * S, docH * S)).save(f'public/media/vine_{W}_left.webp', 'WEBP', **opts)
    full.crop((W * S - side * S, 0, W * S, docH * S)).save(f'public/media/vine_{W}_right.webp', 'WEBP', **opts)
    full.crop((0, 0, W * S, top * S)).save(f'public/media/vine_{W}_top.webp', 'WEBP', **opts)
    sets.append({'width': W, 'docH': docH, 'dpr': S, 'side': side, 'top': top, 'navH': m['navH']})
with open('src/vineSets.json', 'w') as f:
    json.dump(sets, f, indent=1)
    f.write('\n')
print(json.dumps(sets))
