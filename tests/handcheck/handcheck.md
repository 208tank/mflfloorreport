# R5 hand check — the demo tank, one calculation appendix at a time

Each value below was recalculated independently of the app (Python, `tests/handcheck/handcheck.py`) from the demo job's raw inputs, exported by `tests/handcheck/export.mjs`, and compared with the value the app's calculation returned. Values in the job's internal units (mm unless shown). The plate geometry (which plate each indication is on, annular or not, critical zone or not) and the material allowable stresses are taken from the app as inputs; they are not among the calculations checked. The set of repairs is not taken from the app: each auto-repair round is replayed independently (rates from the repairs made so far, then the location furthest below its limit), and every location left unrepaired must meet its limit.

**117 of 117 values agree** (relative tolerance 1 × 10⁻⁶).

## A — Floor MRT (§4.4.5)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| StPᵣ | 0.06096 | 0.06096 | mm/yr | yes |
| MFL threshold rate | 0.0635 | 0.0635 | mm/yr | yes |
| UPᵣ | 0.154432 | 0.154432 | mm/yr | yes |
| StPᵣ + UPᵣ | 0.215392 | 0.215392 | mm/yr | yes |
| bottom: RTip | 4.826 | 4.826 | mm | yes |
| bottom: RTbc | 6.35 | 6.35 | mm | yes |
| bottom: MRT | 2.67208 | 2.67208 | mm | yes |
| bottom: limit | 2.54 | 2.54 | mm | yes |
| bottom: t required today | 4.69392 | 4.69392 | mm | yes |
| bottom: maximum Oᵣ | 10.6132 | 10.6132 | yr | yes |
| annular: RTip | 7.9375 | 7.9375 | mm | yes |
| annular: RTbc | 7.9375 | 7.9375 | mm | yes |
| annular: MRT | 5.78358 | 5.78358 | mm | yes |
| annular: limit | 4.318 | 4.318 | mm | yes |
| annular: t required today | 6.47192 | 6.47192 | mm | yes |
| annular: maximum Oᵣ | 16.8042 | 16.8042 | yr | yes |
| critical: RTip | 7.9375 | 7.9375 | mm | yes |
| critical: RTbc | 7.9375 | 7.9375 | mm | yes |
| critical: MRT | 5.78358 | 5.78358 | mm | yes |
| critical: limit | 4.318 | 4.318 | mm | yes |
| critical: t required today | 6.47192 | 6.47192 | mm | yes |
| critical: maximum Oᵣ | 16.8042 | 16.8042 | yr | yes |
| Repair round 1: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 1: worst location below its limit | 010 | 010 |  | yes |
| Repair round 2: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 2: worst location below its limit | 006 | 006 |  | yes |
| Repair round 3: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 3: worst location below its limit | 003 | 003 |  | yes |
| Repair round 4: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 4: worst location below its limit | 007 | 007 |  | yes |
| Repair round 5: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 5: worst location below its limit | 012 | 012 |  | yes |
| Repair round 6: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 6: worst location below its limit | 008 | 008 |  | yes |
| Repair round 7: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 7: worst location below its limit | 001 | 001 |  | yes |
| Repair round 8: rate | 0.235712 | 0.235712 | mm/yr | yes |
| Repair round 8: worst location below its limit | 013 | 013 |  | yes |
| Repair round 9: rate | 0.220472 | 0.220472 | mm/yr | yes |
| Repair round 9: worst location below its limit | 005 | 005 |  | yes |
| After the last round, no location is below its limit | none | none |  | yes |
| Final repairs = rounds less those pruned | 9 | 9 |  | yes |

## B — Annular plate limit (§4.4.6, Table 4.5)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Sb | 20779.2 | 20779.2 | psi | yes |
| Annular limit (table + CA) | 4.318 | 4.318 | mm | yes |

## C — Critical zone limit (§4.4.5.4)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Course 1 t-min (calculated) | 10.0094 | 10.0094 | mm | yes |
| Critical zone limit | 2.9972 | 2.9972 | mm | yes |

## D — Patch plates (§9.10, §9.11.1)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| P-1: final size L | 304.8 | 304.8 | mm | yes |
| P-2 / 003: L | 304.8 | 304.8 | mm | yes |
| P-2 / 003: W | 304.8 | 304.8 | mm | yes |
| P-2: final size L | 304.8 | 304.8 | mm | yes |
| P-3 / 005: L | 304.8 | 304.8 | mm | yes |
| P-3 / 005: W | 304.8 | 304.8 | mm | yes |
| P-3: final size L | 304.8 | 304.8 | mm | yes |
| P-4 / 006: L | 304.8 | 304.8 | mm | yes |
| P-4 / 006: W | 304.8 | 304.8 | mm | yes |
| P-4: final size L | 304.8 | 304.8 | mm | yes |
| P-5 / 007: L | 304.8 | 304.8 | mm | yes |
| P-5 / 007: W | 304.8 | 304.8 | mm | yes |
| P-6 / 008: L | 304.8 | 304.8 | mm | yes |
| P-6 / 008: W | 304.8 | 304.8 | mm | yes |
| P-7 / 010: L | 304.8 | 304.8 | mm | yes |
| P-7 / 010: W | 304.8 | 304.8 | mm | yes |
| P-7: final size L | 304.8 | 304.8 | mm | yes |
| P-8 / 012: L | 304.8 | 304.8 | mm | yes |
| P-8 / 012: W | 304.8 | 304.8 | mm | yes |
| P-8: final size L | 304.8 | 304.8 | mm | yes |
| P-9 / 013: L | 304.8 | 304.8 | mm | yes |
| P-9 / 013: W | 304.8 | 304.8 | mm | yes |
| P-9: final size L | 304.8 | 304.8 | mm | yes |

## E — Shell t-min and fill heights (§4.3.3)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Course 1: t-min calculated | 10.0094 | 10.0094 | mm | yes |
| Course 1: maximum product fill | 10950.7 | 10950.7 | mm | yes |
| Course 1: hydrotest height | 10262.4 | 10262.4 | mm | yes |
| Course 2: t-min calculated | 7.84523 | 7.84523 | mm | yes |
| Course 2: maximum product fill | 14820 | 14820 | mm | yes |
| Course 2: hydrotest height | 14039.2 | 14039.2 | mm | yes |
| Course 3: t-min calculated | 5.16269 | 5.16269 | mm | yes |
| Course 3: maximum product fill | 16487 | 16487 | mm | yes |
| Course 3: hydrotest height | 15738.1 | 15738.1 | mm | yes |
| Course 4: t-min calculated | 3.19595 | 3.19595 | mm | yes |
| Course 4: maximum product fill | 16972.9 | 16972.9 | mm | yes |
| Course 4: hydrotest height | 16353.4 | 16353.4 | mm | yes |
| Course 5: t-min calculated | 2.54 | 2.54 | mm | yes |
| Course 5: maximum product fill | 17427.4 | 17427.4 | mm | yes |
| Course 5: hydrotest height | 16939.3 | 16939.3 | mm | yes |

## F — Nozzle necks

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| MH1: minimum | 12.2428 | 12.2428 | mm | yes |
| MH1: loss % | 3.6 | 3.6 | % | yes |
| N1: minimum | 8.6614 | 8.6614 | mm | yes |
| N1: loss % | 9.06667 | 9.06667 | % | yes |
| N2: minimum | 8.382 | 8.382 | mm | yes |
| N2: loss % | 12 | 12 | % | yes |
| N3: minimum | 4.4704 | 4.4704 | mm | yes |
| N3: loss % | 47.7745 | 47.7745 | % | yes |

## G — Roof plates (§4.2.1.2)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Fixed roof points below t-min | 1 | 1 |  | yes |
| Deck plates below t-min | 1 | 1 |  | yes |

## H — Rim seal gaps

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Primary: gap area per metre of diameter | 4.65667 | 4.65667 | cm²/m | yes |
| Primary: widest gap | 2.54 | 2.54 | cm | yes |
| Secondary: gap area per metre of diameter | 0.996597 | 0.996597 | cm²/m | yes |
| Secondary: widest gap | 1.524 | 1.524 | cm | yes |

## I — Settlement (Annex B)

| Quantity | Hand | App | Unit | Agrees |
|---|---|---|---|---|
| Cosine fit a | 608.986 | 608.986 | mm | yes |
| Cosine fit b | 24.5729 | 24.5729 | mm | yes |
| Cosine fit c | 12.3364 | 12.3364 | mm | yes |
| R² | 0.97929 | 0.97929 |  | yes |
| Planar tilt (2 √(b² + c²)) | 54.9915 | 54.9915 | mm | yes |
| Out-of-plumbness (tilt / D × H) | 18.3305 | 18.3305 | mm | yes |
| Smax = 11 L² Y / (2 E H) | 50.6492 | 50.6492 | mm | yes |
| Station 1: U | -0.858754 | -0.858754 | mm | yes |
| Station 2: U | -0.164818 | -0.164818 | mm | yes |
| Station 3: U | 2.01405 | 2.01405 | mm | yes |
| Station 4: U | 1.60774 | 1.60774 | mm | yes |
| Station 5: U | 2.21697 | 2.21697 | mm | yes |
| Station 6: U | -8.27327 | -8.27327 | mm | yes |
| Station 7: U | 2.08709 | 2.08709 | mm | yes |
| Station 8: U | 1.39315 | 1.39315 | mm | yes |
| Station 9: U | 2.52428 | 2.52428 | mm | yes |
| Station 10: U | -0.389411 | -0.389411 | mm | yes |
| Station 11: U | -0.988638 | -0.988638 | mm | yes |
| Station 12: U | -1.1684 | -1.1684 | mm | yes |
