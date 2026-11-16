# Small tank hand check (S2)

Independent recalculation of the small tank fixture (`tests/small/small-tank.json`) by `small_handcheck.py` from the raw inputs, compared with the app (`js/smallcalc.js`).

**41 of 41 values agree.**

| Part | Quantity | Hand | App | Unit | |
|---|---|---|---|---|---|
| Floor | T-act (RT, as found) | 0.08 | 0.08 | in | ✓ |
| Floor | CR = StPr + UPr | 0.00766667 | 0.00766667 | in/yr | ✓ |
| Floor | T-min (bottom limit) | 0.1 | 0.1 | in | ✓ |
| Floor | RL as found (largest Or) | 0 | 0 | yr | ✓ |
| Floor | RL after the repairs | 11.7391 | 11.7391 | yr | ✓ |
| Shell | course 1 T-act | 0.231 | 0.231 | in | ✓ |
| Shell | course 1 CR | 0.000633333 | 0.000633333 | in/yr | ✓ |
| Shell | course 1 RL | 206.842 | 206.842 | yr | ✓ |
| Shell | course 2 T-act | 0.18 | 0.18 | in | ✓ |
| Shell | course 2 CR | 0.00025 | 0.00025 | in/yr | ✓ |
| Shell | course 2 RL | 320 | 320 | yr | ✓ |
| Shell | course 3 T-act | 0.178 | 0.178 | in | ✓ |
| Shell | course 3 CR | 0.000316667 | 0.000316667 | in/yr | ✓ |
| Shell | course 3 RL | 246.316 | 246.316 | yr | ✓ |
| Shell | governing course | 1 | 1 |  | ✓ |
| Roof | T-act | 0.15 | 0.15 | in | ✓ |
| Roof | CR | 0.00125 | 0.00125 | in/yr | ✓ |
| Roof | RL | 48 | 48 | yr | ✓ |
| Intervals | UT thickness (§6.3.3.2) | 15 | 15 | yr | ✓ |
| Intervals | external (§6.3.2.1) | 5 | 5 | yr | ✓ |
| Intervals | internal, repairs completed (§6.4.2) | 11.7391 | 11.7391 | yr | ✓ |
| Intervals | internal, not completed | 0 | 0 | yr | ✓ |
| Intervals | internal due date (completed) | 2038-08-13 | 2038-08-13 |  | ✓ |
| Intervals | UT due date | 2041-11-16 | 2041-11-16 |  | ✓ |
| Tilt | height difference across the diameter | 0.559017 | 0.559017 | in | ✓ |
| Tilt | low side bearing | 169.695 | 169.695 | ° | ✓ |
| Tilt | twist residual | -0.0375 | -0.0375 | in | ✓ |
| Tilt | out of plumb from the elevations | 0.624019 | 0.624019 | in | ✓ |
| Tilt | out of plumb from the level readings | 0.6 | 0.6 | in | ✓ |
| Tilt | out of plumb used | 0.624019 | 0.624019 | in | ✓ |
| Tilt | limit (§10.5.2.1: lesser of H/100 and 5 in) | 2.88 | 2.88 | in | ✓ |
| Tilt | freeboard loss on the low side | 0.279508 | 0.279508 | in | ✓ |
| Tilt | drain offset from the low side | 30.3048 | 30.3048 | ° | ✓ |
| Edge | station 1 status | Acceptable | Acceptable |  | ✓ |
| Edge | station 2 status | Exceeds | Exceeds |  | ✓ |
| Edge | station 3 status | Beyond the limit’s distance | Beyond the limit’s distance |  | ✓ |
| Edge | station 4 status | Acceptable | Acceptable |  | ✓ |
| Projection | N meets §4.4.5.7 | yes | yes |  | ✓ |
| Projection | E meets §4.4.5.7 | yes | yes |  | ✓ |
| Projection | S meets §4.4.5.7 | no | no |  | ✓ |
| Projection | W meets §4.4.5.7 | no | no |  | ✓ |
