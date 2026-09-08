"""Install an immutable, resumable atlas; activate only after full readback."""
import argparse, ftplib, hashlib, json, pathlib, re, time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host', nargs='?', default='192.168.8.102')
parser.add_argument('--restart', action='store_true',
                    help='Upload a new temporary copy from byte zero after a readback mismatch')
args = parser.parse_args()

root = pathlib.Path(__file__).resolve().parent.parent
meta = json.loads((root / '.local/3ds/manifest.json').read_text())
if not isinstance(meta.get('name'), str) or not re.fullmatch(r'hyrule-[a-f0-9]{16}-v1', meta['name']):
    raise ValueError('Invalid atlas identity')
local = root / '.local/3ds' / (meta['name'] + '.prp')
slot = hashlib.sha256(json.loads((root / 'pocket.json').read_text())['id'].encode()).hexdigest()[:16]
base = '/pocketjs/assets/' + slot
remote = base + '/' + local.name
partial = remote + '.partial'
host = args.host
with local.open('rb') as source:
    expected = hashlib.file_digest(source, 'sha256').hexdigest()
started = time.monotonic()

def connect():
    ftp = ftplib.FTP()
    ftp.connect(host, 5000, timeout=30)
    ftp.login()
    ftp.voidcmd('TYPE I')
    return ftp

ftp = connect()
for path in ['/pocketjs', '/pocketjs/assets', base]:
    try: ftp.mkd(path)
    except ftplib.error_perm as e:
        if not str(e).startswith('550'): raise
try: installed = not args.restart and ftp.size(remote) == local.stat().st_size
except ftplib.error_perm: installed = False
if not installed:
    for attempt in range(5):
        try:
            if ftp is None: ftp = connect()
            try: offset = 0 if args.restart and attempt == 0 else ftp.size(partial) or 0
            except ftplib.error_perm: offset = 0
            if offset > local.stat().st_size: raise RuntimeError('Oversized partial atlas')
            if offset == local.stat().st_size: break
            progress = [offset, time.monotonic()]
            def sent(block):
                progress[0] += len(block)
                if time.monotonic() - progress[1] > 10:
                    print(f'Upload {progress[0]}/{local.stat().st_size} bytes', flush=True)
                    progress[1] = time.monotonic()
            with local.open('rb') as source:
                source.seek(offset)
                ftp.storbinary('STOR ' + partial, source, 65536, callback=sent,
                               rest=offset if offset else None)
            break
        except (OSError, EOFError, ftplib.error_temp):
            if ftp: ftp.close()
            ftp = None
            if attempt == 4: raise
            time.sleep(1)
    target = partial
else:
    target = remote
digest = hashlib.sha256()
progress = [0, time.monotonic()]
first_difference = None
def received(block):
    global first_difference
    original = source.read(len(block))
    if first_difference is None and block != original:
        first_difference = progress[0] + next(
            (i for i, (a, b) in enumerate(zip(block, original)) if a != b),
            min(len(block), len(original)))
    digest.update(block)
    progress[0] += len(block)
    if time.monotonic() - progress[1] > 10:
        print(f'Verify {progress[0]}/{local.stat().st_size} bytes', flush=True)
        progress[1] = time.monotonic()
with local.open('rb') as source:
    ftp.retrbinary('RETR ' + target, received, 65536, rest=0)
verification = dict(path=target, bytes=progress[0], expectedBytes=local.stat().st_size,
                    sha256=digest.hexdigest(), expectedSha256=expected,
                    firstDifference=first_difference)
(root / 'dist/qa').mkdir(parents=True, exist_ok=True)
(root / 'dist/qa/sd-verify.json').write_text(json.dumps(verification, indent=2))
if progress[0] != local.stat().st_size or digest.hexdigest() != expected:
    ftp.close()
    raise RuntimeError('Atlas readback differs; rerun with --restart: ' + json.dumps(verification))
if not installed:
    ftp.rename(partial, remote)
# The small bootstrap pointer becomes visible only after its complete atlas.
bootstrap = root / '.local/3ds/hyrule.prp'
data = bootstrap.read_bytes()
with bootstrap.open('rb') as source:
    ftp.storbinary('STOR ' + base + '/hyrule.prp.partial', source)
actual = bytearray()
ftp.retrbinary('RETR ' + base + '/hyrule.prp.partial', actual.extend)
assert actual == data, 'Bootstrap readback differs'
ftp.rename(base + '/hyrule.prp.partial', base + '/hyrule.prp')
ftp.quit()
receipt = dict(path=remote, bytes=local.stat().st_size, sha256=expected,
               verified=True, seconds=time.monotonic()-started)
(root / 'dist/qa').mkdir(parents=True, exist_ok=True)
(root / 'dist/qa/sd-install.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt), flush=True)
