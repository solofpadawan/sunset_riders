#!/bin/bash
# Build the public Windows x64 desktop app.
# ROM is NOT included — the in-game loader asks for the user's own MAME ssriders.zip
# (4-player World ver. EAC). Online multiplayer is removed from the packaged UI (web/net is not copied).
set -euo pipefail
cd "$(dirname "$0")"
STAMP=${STAMP:-$(date +%Y%m%d-%H%M%S)}
NAME=${NAME:-SunsetRiders-win64-$STAMP}
rm -rf web out
mkdir web
python3 - <<'PY'
import os, re, shutil
from pathlib import Path
src = Path('../web')
dst = Path('web')
skip_dirs = {'roms', 'net', 'img', 'assets'}
skip_suffix = {'.php', '.bak', '.zip', '.bin', '.nv', '.rom'}
for root, dirs, files in os.walk(src):
    rel = Path(root).relative_to(src)
    dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
    if rel.parts and rel.parts[0] in skip_dirs:
        continue
    (dst / rel).mkdir(parents=True, exist_ok=True)
    for fn in files:
        if Path(fn).suffix.lower() in skip_suffix:
            continue
        shutil.copy2(Path(root) / fn, dst / rel / fn)
html = Path('web/index.html')
t = html.read_text(encoding='utf-8')
t = re.sub(r'<script src="net/[^"]+"></script>', '', t)
# Mark this tree as the public (ROM-not-bundled) build.
t = t.replace('<head>', '<head><script>window.SSR_PUBLIC=1;</script>', 1)
html.write_text(t, encoding='utf-8')
PY
if [ -d web/net ]; then echo "web/net must not be present in the desktop build" >&2; exit 1; fi
if [ -d web/assets ]; then echo "extracted assets must not be bundled in the public build" >&2; exit 1; fi
if [ -e web/roms/ssriders.zip ] || [ -e web/assets/prog.bin ]; then echo "ROM must not be bundled in the public build" >&2; exit 1; fi
if find web -iname '*.zip' -o -iname 'ssriders*' -o -iname '*.bin' -o -iname '*.rom' -o -iname '*.nv' | grep -q .; then
  echo "refuse: ROM or binary dump leaked into desktop web/" >&2; exit 1
fi
if grep -R -E -q 'games4me-netplay|workers\.dev|peerjs\.com|/scores/report' web --include='*.js' --include='*.html' --include='*.css'; then
  echo "web/ still contains online endpoints" >&2; exit 1
fi
rm -rf out
npx @electron/packager . SunsetRiders --platform=win32 --arch=x64 --out=out --icon=icon.ico --asar --extra-resource=web \
  --ignore='^/web' --ignore='^/out' --ignore='\.gitignore' --ignore='build\.sh' \
  --win32metadata.ProductName="Sunset Riders" --win32metadata.FileDescription="Sunset Riders arcade HTML5 remake"
mv out/SunsetRiders-win32-x64 out/SunsetRiders
mkdir -p ../dist/desktop
(cd out && python3 -c "import shutil,sys; shutil.make_archive('../../dist/desktop/' + sys.argv[1], 'zip', '.', 'SunsetRiders')" "$NAME")
echo "ZIP ../dist/desktop/$NAME.zip"
