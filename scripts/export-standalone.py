#!/usr/bin/env python3
"""Export the exact shipped game into a dependency-free HTML artifact."""
import argparse
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path, help='Path of the generated standalone HTML')
args = parser.parse_args()
html = (root / 'index.html').read_text(encoding='utf-8')
for name in ('tenka-calendar.js','tenka-auto-battle.js','tenka-turn-ui.js','tenka-portraits.js', 'tenka-castles.js', 'tenka-fortress-materials.js', 'tenka-castle-models.js', 'tenka-castle-precincts.js', 'tenka-battlefield.js', 'tenka-battle-environment.js','tenka-battle-2d.js','tenka-battle-scenes.js', 'tenka-systems.js', 'tenka-dynasty.js', 'tenka-tactics.js', 'tenka-orders.js','tenka-retainers.js','tenka-allies.js','tenka-diplomacy.js','tenka-transfers.js','tenka-routes.js','tenka-supplies.js', 'tenka-ui.js'):
    content = (root / name).read_text(encoding='utf-8')
    if '</script' in content.lower():
        raise ValueError(f'Unsafe inline script terminator in {name}')
    tags = re.findall(r'<script src="' + re.escape(name) + r'(?:\?[^"<>]*)?"></script>', html)
    if len(tags) != 1:
        raise ValueError(f'Expected exactly one script reference: {name}')
    html = html.replace(tags[0], f'<script>\n{content}\n</script>')
for name in ('tenka-ui.css', 'tenka-routes.css', 'tenka-supplies.css', 'tenka-battle-session.css','tenka-turn-ui.css'):
    style_tags = re.findall(r'<link rel="stylesheet" href="' + re.escape(name) + r'(?:\?[^"<>]*)?">', html)
    if len(style_tags) != 1:
        raise ValueError(f'Expected exactly one stylesheet reference: {name}')
    html = html.replace(style_tags[0], '<style>\n' + (root / name).read_text(encoding='utf-8') + '\n</style>')
if re.search(r'<script\b[^>]*\bsrc\s*=', html, re.I):
    raise ValueError('A runtime script still requires another file')
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html, encoding='utf-8')
print(f'Exported {args.output} ({args.output.stat().st_size:,} bytes)')
