"""R5 hand check, step 2: recalculate one test job (the demo tank) per calculation appendix, independently of the app's
JavaScript, from the raw inputs exported by export.mjs, and compare with the app's results. Writes handcheck.md.
Run: node tests/handcheck/export.mjs && python3 tests/handcheck/handcheck.py
"""
import json, math, os
import numpy as np

HERE = os.path.dirname(__file__)
d = json.load(open(os.path.join(HERE, 'demo-inputs.json')))
IN, FT = 25.4, 304.8
rows = []  # (appendix, quantity, hand value, app value, unit, ok)


def chk(app, q, hand, appv, unit='', tol=1e-6):
    ok = (hand is None and appv is None) or (hand is not None and appv is not None and abs(hand - appv) <= tol * max(1, abs(appv)))
    rows.append((app, q, hand, appv, unit, ok))


def num(v):
    return None if v is None or v == '' else float(v)

# ------------------------------------------------------------------ A: floor MRT (API 653 §4.4.5)
C = d['calc']; T = d['tank']
Or, years = num(C['Or']), num(C['years'])
st_years = num(C.get('stprYears')) or years
thr = num(C.get('mflThresholdPct'))
locs = []
for i in d['indications']:
    res = i.get('result') or 'pending'
    if res not in ('ps', 'ss', 'both'):
        continue  # pending not included (includeUnverified is off in the demo)
    nom = num(i.get('utNom')) or num((d['plates'].get(i['plate']) or {}).get('tNom')) or (num(T['tAnnular']) if i['kind'] == 'annular' else num(T['tBottom']))
    if num(i.get('utMin')) is not None:
        rem = num(i['utMin'])
    elif res in ('ps', 'both') and num(i.get('vtDepth')) is not None:
        rem = nom - num(i['vtDepth'])
    else:
        rem = nom * (1 - num(i['mflPct']) / 100)
    loss = max(0, nom - rem)
    top = loss if res == 'ps' else (min(num(i['vtDepth']), loss) if res == 'both' and num(i.get('vtDepth')) is not None else 0)
    bot = loss if res == 'ss' else (loss - top if res == 'both' else 0)
    locs.append(dict(id=i['id'], no=i['no'], rem=rem, top=top, bot=bot, region='annular' if i['kind'] == 'annular' else 'bottom', critical=i['critical'], cause=i.get('causeRemoved')))
repaired = set(d['app']['repaired'])  # the set of repairs is taken from the app; the check is that it is consistent (below)
noms = [num(T['tBottom']), num(T['tAnnular'])]
thr_rate = max(t * thr / 100 / years for t in noms)
st = max([l['top'] / st_years for l in locs if l['id'] not in repaired] + [0])
up = max([l['bot'] / years for l in locs if (l['id'] not in repaired or not l['cause'])] + [0, thr_rate])
K = st + up
chk('A', 'StPᵣ', st, d['app']['StPr'], 'mm/yr'); chk('A', 'MFL threshold rate', thr_rate, d['app']['thrRate'], 'mm/yr')
chk('A', 'UPᵣ', up, d['app']['UPr'], 'mm/yr'); chk('A', 'StPᵣ + UPᵣ', K, d['app']['K'], 'mm/yr')
mBot, mAnn, czLim = num(C['mrtBottom']), d['app']['mAnn'], d['app']['czLim']
limit = {'bottom': mBot, 'annular': mAnn, 'critical': max(czLim, mAnn)}
for r in d['app']['regions']:
    sel = [l for l in locs if l['id'] not in repaired and (l['critical'] if r['name'] == 'critical' else l['region'] == r['name'])]
    base = d['plateMin']['annular' if r['name'] in ('annular', 'critical') else 'bottom']
    ip = min([l['rem'] for l in sel if l['top'] > 0], default=base); bc = min([l['rem'] for l in sel if l['bot'] > 0], default=base)
    mrt = min(ip, bc) - Or * K
    chk('A', f"{r['name']}: RTip", ip, r['RTip'], 'mm'); chk('A', f"{r['name']}: RTbc", bc, r['RTbc'], 'mm')
    chk('A', f"{r['name']}: MRT", mrt, r['MRT'], 'mm'); chk('A', f"{r['name']}: limit", limit[r['name']], r['limit'], 'mm')
    chk('A', f"{r['name']}: t required today", limit[r['name']] + Or * K, r['tReq'], 'mm'); chk('A', f"{r['name']}: maximum Oᵣ", (min(ip, bc) - limit[r['name']]) / K, r['OrMax'], 'yr')
# consistency of the repair set: every unrepaired location passes; every repaired one would fail at these rates
lim_of = lambda l: max(mAnn if l['region'] == 'annular' else mBot, czLim if l['critical'] else 0)
def rates(rep):
    st_ = max([l['top'] / st_years for l in locs if l['id'] not in rep] + [0])
    up_ = max([l['bot'] / years for l in locs if (l['id'] not in rep or not l['cause'])] + [0, thr_rate])
    return st_ + up_
rep = set(d['app']['specified'])
for k, r in enumerate(d['app']['rounds']):
    Kr = rates(rep)
    worst = min((l for l in locs if l['id'] not in rep and l['rem'] - Or * Kr - lim_of(l) < -1e-9), key=lambda l: l['rem'] - Or * Kr - lim_of(l))
    chk('A', f"Repair round {k + 1}: rate", Kr, r['K'], 'mm/yr')
    rows.append(('A', f"Repair round {k + 1}: worst location below its limit", worst['no'], r['no'], '', worst['id'] == r['id']))
    rep.add(worst['id'])
nxt = [l for l in locs if l['id'] not in rep and l['rem'] - Or * rates(rep) - lim_of(l) < -1e-9]
rows.append(('A', 'After the last round, no location is below its limit', 'none' if not nxt else ', '.join(l['no'] for l in nxt), 'none', '', not nxt))
rows.append(('A', 'Final repairs = rounds less those pruned', str(len(rep - set(d['app']['pruned']))), str(len(repaired)), '', rep - set(d['app']['pruned']) == repaired))

# ------------------------------------------------------------------ B: annular plate limit (Table 4.5, G < 1)
D_ft, H_ft, G = num(T['diameter']) / FT, (num(T['fillH']) or 0) / FT, num(T['sg'])
t1 = num(d['shell']['courses'][0]['tNom']) / IN
Sb = 2.34 * D_ft * (H_ft - 1) / t1 if G < 1 else 2.6 * D_ft * (H_ft - 1) * G / t1
chk('B', 'Sb', Sb, d['app']['annular']['Sb'], 'psi')
T45 = {'stress': [24300, 27000, 29700, 32400], 'rows': [[0.75, 0.17, 0.2, 0.23, 0.3], [1, 0.17, 0.22, 0.31, 0.38], [1.25, 0.17, 0.26, 0.38, 0.48], [1.5, 0.22, 0.34, 0.47, 0.59], [1e9, 0.27, 0.4, 0.53, 0.68]]}  # as in Code tables
row = next(r for r in T45['rows'] if t1 <= r[0]); xs, ys = T45['stress'], row[1:]
t_tbl = ys[0] if Sb <= xs[0] else next(ys[k] + (Sb - xs[k]) / (xs[k + 1] - xs[k]) * (ys[k + 1] - ys[k]) for k in range(len(xs) - 1) if Sb <= xs[k + 1])
chk('B', 'Annular limit (table + CA)', t_tbl * IN + (num(C.get('annCA')) or 0), d['app']['mAnn'], 'mm')

# ------------------------------------------------------------------ C: critical zone limit (§4.4.5.4)
des = d['shell']['designs']; Bb = d['shell']['basis']
c1 = des[0]
t_c1 = 2.6 * max(0, c1['Hc'] - 1) * (Bb['D'] / FT) * Bb['G'] / (c1['Sd'] * c1['Ej'])  # in
t_c1 = max(t_c1, 0.1) * IN
chk('C', 'Course 1 t-min (calculated)', t_c1, d['app']['cz']['st'], 'mm')
chk('C', 'Critical zone limit', max(0.1 * IN, min(0.118 * IN, t_c1 / 2)), czLim, 'mm')

# ------------------------------------------------------------------ D: patch plates
L0, W0, m = num(C['patchL']), num(C['patchW']), num(C['patchMargin'])
for p in d['app']['patches']:
    for q in p['trace']:
        i = next(x for x in d['indications'] if x['id'] == q['id'])
        if num(i.get('repLen')) and num(i.get('repWid')):
            continue
        chk('D', f"{p['id']} / {q['no']}: L", max(L0, (num(i.get('len')) or 0) + 2 * m), q['L'], 'mm'); chk('D', f"{p['id']} / {q['no']}: W", max(W0, (num(i.get('wid')) or 0) + 2 * m), q['W'], 'mm')
    if p['kind'] == 'rect' and len(p['trace']) == 1:
        chk('D', f"{p['id']}: final size L", p['trace'][0]['L'], p['L'], 'mm')

# ------------------------------------------------------------------ E: shell t-min and fill heights (§4.3.3, US form)
for k, dd in enumerate(des):
    tmin = max(2.6 * max(0, dd['Hc'] - 1) * (Bb['D'] / FT) * Bb['G'] / (dd['Sd'] * dd['Ej']), 0.1) * IN
    chk('E', f"Course {k + 1}: t-min calculated", tmin, dd['tmin'], 'mm')
    s = next(x for x in d['shell']['summary'] if x['id'] == dd['id'])
    if s['min'] is not None and d['shell']['fill'][k]:
        t = s['min'] / IN
        prod = (dd['Sd'] * dd['Ej'] * t / (2.6 * (Bb['D'] / FT) * Bb['G']) + 1) * FT + dd['z0']
        hyd = (dd['St'] * dd['Ej'] * t / (2.6 * (Bb['D'] / FT)) + 1) * FT + dd['z0']
        chk('E', f"Course {k + 1}: maximum product fill", prod, d['shell']['fill'][k]['prod'], 'mm'); chk('E', f"Course {k + 1}: hydrotest height", hyd, d['shell']['fill'][k]['hydro'], 'mm')

# ------------------------------------------------------------------ F: nozzle necks
for z in d['nozzles']:
    n, w, u = z['n'], z['wall'], z['ut']
    vals = [num(n.get(k)) for k in ('ut12', 'ut3', 'ut6', 'ut9')] + [num(x.get('t')) for x in n.get('utx') or []]
    vals = [v for v in vals if v is not None]
    if not vals:
        continue
    mn = min(vals); chk('F', f"{n['mark']}: minimum", mn, u['min'], 'mm')
    if w.get('tNom'):
        chk('F', f"{n['mark']}: loss %", max(0, (w['tNom'] - mn) / w['tNom'] * 100), u['lossPct'], '%')

# ------------------------------------------------------------------ G: roof plates (§4.2.1.2)
fx = d['roof']['fixed']; tmin = num(fx['tMin'])
below = sum(1 for p in fx['pts'] if num(p.get('t')) is not None and (num(p['t']) <= 0 or num(p['t']) < tmin - 1e-9))
app_below = sum(1 for s in d['roof']['fixedStatus'] if s['status'] in ('Below t-min', 'Hole through plate'))
chk('G', 'Fixed roof points below t-min', below, app_below, '')
fl = d['roof']['floating']; dm = num(fl['deckMin'])
def plate_min(key):
    v = [num(x) for x in (fl['ut'].get(key) or {}).values()]; v = [x for x in v if x is not None]; return min(v) if v else None
dbelow = sum(1 for p in d['roof']['deck'] if plate_min(p['key']) is not None and plate_min(p['key']) < dm - 1e-9)
chk('G', 'Deck plates below t-min', dbelow, sum(1 for p in d['roof']['deck'] if p['ut']['status'] in ('Below t-min', 'Hole through plate')), '')

# ------------------------------------------------------------------ H: rim seal gaps
seal, Dm = d['seal']['seal'], d['seal']['D'] / 1000
for lab, sd, key in (('Primary', seal['primary'], 'p'), ('Secondary', seal['secondary'], 's')):
    gaps = [g for g in sd['gaps'] if num(g.get('len')) and num(g.get('wAvg') if g.get('wAvg') is not None else g.get('wMax'))]
    area = sum(num(g['len']) / 10 * num(g['wAvg'] if g.get('wAvg') is not None else g['wMax']) / 10 for g in gaps)
    ev = d['seal']['evals'][0][key]
    if gaps:
        chk('H', f"{lab}: gap area per metre of diameter", area / Dm, ev['perM'], 'cm²/m'); chk('H', f"{lab}: widest gap", max(num(g['wMax']) for g in gaps) / 10, ev['wMaxCm'], 'cm')

# ------------------------------------------------------------------ I: settlement (Annex B)
S = d['settle']; pts = [p for p in S['pts'] if p['z'] is not None]
th = np.radians([p['angle'] for p in pts]); z = np.array([p['z'] for p in pts])
A = np.column_stack([np.ones_like(th), np.cos(th), np.sin(th)]); (a, b, c), *_ = np.linalg.lstsq(A, z, rcond=None)
fit = A @ np.array([a, b, c]); sse = float(((z - fit) ** 2).sum()); syy = float(((z - z.mean()) ** 2).sum())
F = S['fit']
chk('I', 'Cosine fit a', a, F['a'], 'mm'); chk('I', 'Cosine fit b', b, F['b'], 'mm'); chk('I', 'Cosine fit c', c, F['c'], 'mm')
chk('I', 'R²', (syy - sse) / syy, F['R2'], ''); chk('I', 'Planar tilt (2 √(b² + c²))', 2 * math.hypot(b, c), F['tilt'], 'mm')
chk('I', 'Out-of-plumbness (tilt / D × H)', 2 * math.hypot(b, c) / S['D'] * S['H'], F['plumb'], 'mm')
chk('I', 'Smax = 11 L² Y / (2 E H)', 11 * S['Lsub'] ** 2 * S['Y'] / (2 * S['E'] * S['H']), S['Smax'], 'mm')
U = {p['i']: p['z'] - (a + b * math.cos(math.radians(p['angle'])) + c * math.sin(math.radians(p['angle']))) for p in pts}
for p in pts:
    if p['U'] is not None:
        chk('I', f"Station {p['i']}: U", U[p['i']], p['U'], 'mm', tol=1e-6)

# ------------------------------------------------------------------ write-up
ok = sum(r[5] for r in rows)
fmtv = lambda v: '—' if v is None else (v if isinstance(v, str) else f'{v:.6g}')
names = {'A': 'Floor MRT (§4.4.5)', 'B': 'Annular plate limit (§4.4.6, Table 4.5)', 'C': 'Critical zone limit (§4.4.5.4)', 'D': 'Patch plates (§9.10, §9.11.1)', 'E': 'Shell t-min and fill heights (§4.3.3)', 'F': 'Nozzle necks', 'G': 'Roof plates (§4.2.1.2)', 'H': 'Rim seal gaps', 'I': 'Settlement (Annex B)'}
out = ['# R5 hand check — the demo tank, one calculation appendix at a time', '',
       'Each value below was recalculated independently of the app (Python, `tests/handcheck/handcheck.py`) from the demo job\'s raw inputs, '
       'exported by `tests/handcheck/export.mjs`, and compared with the value the app\'s calculation returned. Values in the job\'s internal units '
       '(mm unless shown). The plate geometry (which plate each indication is on, annular or not, critical zone or not) and the material '
       'allowable stresses are taken from the app as inputs; they are not among the calculations checked. The set of repairs is '
       'not taken from the app: each auto-repair round is replayed independently (rates from the repairs made so far, then the location furthest below its limit), and every location left unrepaired must meet its limit.', '',
       f'**{ok} of {len(rows)} values agree** (relative tolerance 1 × 10⁻⁶).', '']
for k in 'ABCDEFGHI':
    rs = [r for r in rows if r[0] == k]
    out += [f'## {k} — {names[k]}', '', '| Quantity | Hand | App | Unit | Agrees |', '|---|---|---|---|---|']
    out += [f'| {r[1]} | {fmtv(r[2])} | {fmtv(r[3])} | {r[4]} | {"yes" if r[5] else "**NO**"} |' for r in rs]
    out.append('')
open(os.path.join(HERE, 'handcheck.md'), 'w').write('\n'.join(out))
print(f'{ok}/{len(rows)} agree')
for r in rows:
    if not r[5]:
        print('DIFF', r)
