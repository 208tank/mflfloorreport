"""S2 hand check, step 2: recalculate the small tank fixture's small-report results (thickness and corrosion rates,
inspection intervals, planar tilt, edge settlement, floor projections) independently of the app's JavaScript, from the
raw inputs exported by small-export.mjs, and compare with the app's results. Writes small-handcheck.md.
Run: node tests/handcheck/small-export.mjs && python3 tests/handcheck/small_handcheck.py
"""
import json, math, os, datetime

HERE = os.path.dirname(__file__)
d = json.load(open(os.path.join(HERE, 'small-inputs.json')))
IN, FT = 25.4, 304.8
rows = []


def chk(part, q, hand, appv, unit='', tol=1e-6):
    if appv == 'inf':
        appv = math.inf
    if hand is None or appv is None:
        ok = hand is None and appv is None
    elif isinstance(hand, str):
        ok = hand == appv
    elif math.isinf(hand) or (isinstance(appv, float) and math.isinf(appv)):
        ok = hand == appv
    else:
        ok = abs(hand - appv) <= tol * max(1, abs(appv))
    rows.append((part, q, hand, appv, unit, ok))


def num(v):
    return None if v is None or v == '' else float(v)


A = d['app']; T = d['tank']; C = d['calc']
years = num(C['years'])

# ------------------------------------------------------------------ floor (§4.4.5), as found and after the repairs
nom = num(T['tBottom'])
locs = []
for i in d['indications']:
    res = i['result']
    if i.get('utMin') is not None:
        rem = num(i['utMin'])
    elif i.get('vtDepth') is not None:
        rem = nom - num(i['vtDepth'])
    else:
        continue
    loss = nom - rem
    top = loss if res == 'ps' else 0.0
    bot = loss if res == 'ss' else 0.0
    assert not i['critical'] and i['region'] == 'bottom', 'hand check assumes bottom plates only'
    locs.append(dict(id=i['id'], rem=rem, top=top, bot=bot, side=res))
thr = num(C['mflThresholdPct'])
thr_rate = nom * thr / 100 / years                      # §4.4.5.1 Note 1 (no CP, floor scanned)
limit = num(C['mrtBottom'])


def floor(repaired):
    st = max([l['top'] / years for l in locs if l['id'] not in repaired] + [0])
    up = max([l['bot'] / years for l in locs] + [thr_rate])   # repaired soil-side locations keep their rate (Note 1)
    ip = [l['rem'] for l in locs if l['side'] == 'ps' and l['id'] not in repaired]
    bc = [l['rem'] for l in locs if l['side'] == 'ss' and l['id'] not in repaired]
    RT = min(min(ip) if ip else nom, min(bc) if bc else nom)
    K = st + up
    return RT, K, max(0, (RT - limit) / K)


RT0, K0, Or0 = floor(set())
RT1, K1, Or1 = floor(set(d['repaired']))
F = A['thick']['floor']
chk('Floor', 'T-act (RT, as found)', RT0 / IN, F['tAct'] / IN, 'in')
chk('Floor', 'CR = StPr + UPr', K0 / IN, F['cr'] / IN, 'in/yr')
chk('Floor', 'T-min (bottom limit)', limit / IN, F['tMin'] / IN, 'in')
chk('Floor', 'RL as found (largest Or)', Or0, F['rl'], 'yr')
chk('Floor', 'RL after the repairs', Or1, F['rlAfter'], 'yr')

# ------------------------------------------------------------------ shell and roof: CR = (Tnom - Tact)/yr, RL = RCA/CR
gov = None
for c in d['courses']:
    vals = [num(v) for m in d['rd'].values() for z, v in m.items() if v is not None and c['z0'] - 1e-6 <= float(z) < c['z1'] - 1e-6]
    tact = min(vals); cr = max(0, (c['tNom'] - tact) / years); rca = tact - c['tMin']
    rl = 0 if rca <= 0 else (math.inf if cr == 0 else rca / cr)
    app = next(x for x in A['thick']['courses'] if x['course'] == c['no'])
    chk('Shell', f'course {c["no"]} T-act', tact / IN, app['tAct'] / IN, 'in')
    chk('Shell', f'course {c["no"]} CR', cr / IN, app['cr'] / IN, 'in/yr')
    chk('Shell', f'course {c["no"]} RL', rl, app['rl'], 'yr')
    if gov is None or rl < gov[2]:
        gov = (c['no'], rca, rl, cr)
chk('Shell', 'governing course', float(gov[0]), float(A['thick']['shell']['course']))
R = d['roof']
rv = [num(p['t']) for p in R['pts'] if p.get('t') is not None]
tact = min(rv); cr = (num(R['tNom']) - tact) / years; rl = (tact - num(R['tMin'])) / cr
chk('Roof', 'T-act', tact / IN, A['thick']['roof']['tAct'] / IN, 'in')
chk('Roof', 'CR', cr / IN, A['thick']['roof']['cr'] / IN, 'in/yr')
chk('Roof', 'RL', rl, A['thick']['roof']['rl'], 'yr')

# ------------------------------------------------------------------ intervals: §6.3.3.2, §6.3.2.1, §6.4.2
_, rca, _, n = gov
ut = min(15, math.inf if n == 0 else rca / (2 * n))
ext = min(5, math.inf if n == 0 else rca / (4 * n))
cap = 30 if T.get('rpb') else 20
I = A['intervals']
chk('Intervals', 'UT thickness (§6.3.3.2)', ut, I['ut']['done']['years'], 'yr')
chk('Intervals', 'external (§6.3.2.1)', ext, I['ext']['done']['years'], 'yr')
chk('Intervals', 'internal, repairs completed (§6.4.2)', min(cap, Or1), I['int']['done']['years'], 'yr')
chk('Intervals', 'internal, not completed', min(cap, Or0), I['int']['not']['years'], 'yr')


def add_years(iso, y):
    t = datetime.date.fromisoformat(iso)
    w = int(math.floor(y))
    t = t.replace(year=t.year + w)
    return (t + datetime.timedelta(days=round((y - w) * 365.25))).isoformat()


chk('Intervals', 'internal due date (completed)', add_years(d['inspDate'], min(cap, Or1)), I['int']['done']['date'])
chk('Intervals', 'UT due date', add_years(d['inspDate'], ut), I['ut']['done']['date'])

# ------------------------------------------------------------------ planar tilt (small-tank method)
S = d['small']; D = num(T['diameter']); H = num(T['height'])
z = {t['loc']: num(t['elev']) for t in S['tilt']}
lean = {t['loc']: num(t['lean']) for t in S['tilt']}
sx, sy = (z['E'] - z['W']) / D, (z['N'] - z['S']) / D
slope = math.hypot(sx, sy)
low = (math.degrees(math.atan2(-sx, -sy)) + 360) % 360
twist = ((z['N'] + z['S']) - (z['E'] + z['W'])) / 4
Lv = num(S['level'])
lean_max = max(abs(v) / Lv for v in lean.values() if v is not None) * H
plumb = max(slope * H, lean_max)
P = A['tilt']['planar']
chk('Tilt', 'height difference across the diameter', slope * D / IN, P['diff'] / IN, 'in')
chk('Tilt', 'low side bearing', low, P['lowDeg'], '°')
chk('Tilt', 'twist residual', twist / IN, P['twist'] / IN, 'in')
chk('Tilt', 'out of plumb from the elevations', slope * H / IN, P['plumbElev'] / IN, 'in')
chk('Tilt', 'out of plumb from the level readings', lean_max / IN, P['leanMax'] / IN, 'in')
chk('Tilt', 'out of plumb used', plumb / IN, A['tilt']['plumb'] / IN, 'in')
chk('Tilt', 'limit (§10.5.2.1: lesser of H/100 and 5 in)', min(H / 100, 5 * IN) / IN, A['tilt']['plumbLim'] / IN, 'in')
chk('Tilt', 'freeboard loss on the low side', slope * D / 2 / IN, P['freeboard'] / IN, 'in')
drain = next(n for n in d['nozzles'] if 'drain' in n['type'].lower())
off = abs(((drain['angle'] - low + 540) % 360) - 180)
chk('Tilt', 'drain offset from the low side', off, P['drain']['off'], '°')

# ------------------------------------------------------------------ edge settlement (entered limit and distance)
L = num(S['lim']['edge']); dist = num(S['lim']['edgeDist'])
for e, app in zip(S['edge'], A['edge']['rows']):
    B, Rb = num(e['max']), num(e['bo'])
    st = ('Beyond the limit’s distance' if Rb > dist else ('Exceeds' if B > L else 'Acceptable'))
    chk('Edge', f'station {e["st"]} status', st, app['status'])

# ------------------------------------------------------------------ floor projections (§4.4.5.7)
for p, app in zip(S['proj'], A['proj']):
    ok = num(p['t']) >= 0.10 * IN - 1e-9 and num(p['len']) >= 0.375 * IN - 1e-9
    chk('Projection', f'{p["loc"]} meets §4.4.5.7', 'yes' if ok else 'no', 'yes' if app['ok'] else 'no')


def f(v):
    if isinstance(v, str):
        return v
    if v is None:
        return '—'
    if isinstance(v, float) and math.isinf(v):
        return '∞'
    return f'{v:.6g}'


n_ok = sum(1 for r in rows if r[5])
out = ['# Small tank hand check (S2)', '', 'Independent recalculation of the small tank fixture (`tests/small/small-tank.json`) by `small_handcheck.py` '
       'from the raw inputs, compared with the app (`js/smallcalc.js`).', '', f'**{n_ok} of {len(rows)} values agree.**', '',
       '| Part | Quantity | Hand | App | Unit | |', '|---|---|---|---|---|---|']
out += [f'| {a} | {q} | {f(h)} | {f(v)} | {u} | {"✓" if ok else "✗"} |' for a, q, h, v, u, ok in rows]
open(os.path.join(HERE, 'small-handcheck.md'), 'w').write('\n'.join(out) + '\n')
print(f'{n_ok}/{len(rows)} agree')
for r in rows:
    if not r[5]:
        print('MISMATCH', r)
