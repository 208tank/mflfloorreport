# Tank Floor Inspector

An offline-first Progressive Web App for documenting aboveground storage tank floor inspections:
MFL scanning indications, UT and VT prove-up of product side and soil side corrosion, a plate map
drawing, the API 653 bottom minimum remaining thickness (MRT) calculation, and a printable report.

Plain HTML, CSS and JavaScript modules. No build step, no server, no external libraries — it runs
from GitHub Pages and keeps working with no connection once opened.

## Report — logo and page headers (v3.38.0)

- The company logo prints **larger on the cover** (up to 130 px high, was 70).
- The logo is now in **every page header** by default (left, beside the company name; header logo 150 × 34, was
  110 × 26). Companies that saved their own header settings keep their logo choice: set it under Jobs → *Report page
  header and footer*. With nothing in the centre position, the left and right header / footer boxes share the width,
  so the logo and the text beside it stay on one line.
- **Drawing sheets** (floor plan, shell roll-out, roof plans) print with **no running header or footer**: the sheet's
  title block already carries the company, logo, tank, report, revision and DRAFT / ISSUED. The cover has none either.

Golden report files changed only in these page styles.

## User guide in the app (v3.37.0)

**User guide** (last item in the side menu, open with or without a job) is the step-by-step guide for crews: the
flow at a glance, eight steps from setting up the device to a Complete job, the rest of the tank, and tips, shortcuts
and common mistakes. It has a contents list, a search box, **Print** (the guide alone, to hand out) and buttons that
open the page each step talks about. Works offline like the rest of the app.

The text is in `js/guide.js`. It is kept current with the app: `tests/guide.test.mjs` fails when `GUIDE_VERSION` is
behind `APP_VERSION`, when a side-menu or data page isn't mentioned, or when a floor map layer isn't. `CLAUDE.md`
records the release checklist (guide, README, the shared copy of the guide).

## Floor map and floor plan — drawing layers (v3.36.0)

Anything that clutters the floor drawing can be switched off:

- **Floor map → Layers** (the toolbar menu, which shows how many layers are hidden): indications, indication numbers,
  plate labels, datum marks, **shell nozzles**, **floor features** (sumps, roof columns, existing patches, other),
  **shell seams**, the critical zone line, repair patches, UT readings and the MFL scan coverage hatching. *Show all*
  puts everything back; *Plates and indications only* hides the rest. While placing a nozzle, feature or indication
  its layer is shown. With nozzles hidden the drawing closes in to the shell. The SVG / PNG map export follows the
  layers shown on the Floor map.
- **Report → Report sections and layout → Floor plan layers**: the same switches for the floor plan drawing sheet in
  the full report and the small tank report (kept on this device; *Plate labels on map* and *Datum marks* moved
  here). Everything is on by default, so reports print as before.

## Floor map — Indications toggle (v3.35.1)

The floor map has an **Indications** switch (now in the *Layers* menu, v3.36.0): untick it to hide every MFL indication on the map (for example to look at the plates, UT readings or patches
underneath), tick it to show them again. Starting *+ Indication* (or *N*) or moving an indication turns them back on,
so a new one is never placed out of sight. The result chips still filter by prove-up result when indications are
shown. The printed report is unchanged.

## Floor UT readings — areas, critical zone and lower shell scans, five readings per plate (v3.35.0, schema 7)

**Floor → UT readings** (beside Floor map, Indications and Plates) records UT thickness on the floor in three ways:

1. **Selected areas** — each area is placed by its **plate** and the **centre of the area** measured X / Y from the
   plate's datum corner (the same convention as an indication), with its **length** along X and **width** along Y.
   Record the **minimum** and **average** thickness, a **condition** (general thinning, general pitting, widely
   scattered pitting, isolated pitting, localized corrosion, lamination / inclusion, no significant loss, or a custom
   description), the **side of the loss** if known, and notes. Areas can be typed in (*+ Area*) or placed by clicking
   the Floor map (*+ UT area*, Shift-click for several).
2. **Critical zone scans** — a square scan (6 × 6 in by default, 150 mm metric) inside the shell with its outer edge
   at the shell, every **spacing** set by the inspector (arc length along the shell, default 10 ft / 3 m) from a
   **first scan angle**, clockwise, numbered CZ-1, CZ-2 …. The last gap back to CZ-1 is shown when the spacing doesn't
   divide the circumference. Each scan records a minimum, average and note. Readings are kept by angle, so changing
   the spacing keeps any reading still on a scan and reports the others.
3. **Lower shell scans** (option under the critical zone scans) — the same locations and size on course 1 just above
   the shell-to-bottom weld: minimum, average and note, compared with the course 1 t-min (entered, else calculated
   per §4.3.3), with the shell rules: below 60 % of t-min fails §4.3.2.1, otherwise below t-min is evaluated per §4.3.2.
4. **Five readings per plate** — the four corners and the centre of every bottom and annular plate, placed as on a
   floating roof deck (corners inset 15 %, pulled inside cut plates).

**In the API 653 evaluation** (`api653`, the floor chapter and the calculation appendix) every UT reading is a
remaining thickness in its area (bottom, annular, critical zone — a CZ scan always, an area when its extent reaches
the zone, a plate reading when it is within the critical zone distance of the shell):

- A reading with no known side is **general thickness**: the least one is **RTᵤₜ**, and RT = min(RTᵢₚ, RTᵦc, RTᵤₜ).
  It does not change StPᵣ / UPᵣ. An area marked product side or soil side joins RTᵢₚ or RTᵦc and its loss
  (nominal − minimum) sets StPᵣ / UPᵣ like a proven-up indication.
- A critical zone scan adds the critical zone area to the evaluation, with the critical zone limit.
- Each reading is checked at Oᵣ (t − Oᵣ × (StPᵣ + UPᵣ) against its area's limit). UT readings are **not repaired
  automatically**: readings below the minimum are listed in a warning and on the API 653 page; record the repair as
  an indication, or shorten Oᵣ. Lower shell scans below t-min are a warning too.
- With no UT readings, every result is exactly as before (the golden calculation and report files are unchanged apart
  from the schema number).

**Elsewhere:** the floor map draws areas (outlined at their size), CZ scans (squares at the shell), plate readings
(dots) and lower shell scans (bars outside the shell) in green / red by status, with a *UT* toggle. The report's floor
chapter gains **UT thickness survey** (scope and results, areas, critical zone and lower shell scans, plate readings)
and an RTᵤₜ column in the area evaluation; the small tank report prints the same tables in its MFL appendix. *Export
CSV* on the screen writes every reading. The **UT loader sheet** gains *Floor UT areas*, *Floor CZ scans* and *Floor
plates* sheets, read back with the same preview and conflict rules.

Data: `job.floorUT` = `{ areas: [{ id, no, plate, x, y, len, wid, tMin, tAvg, type, typeText, side, notes }],
cz: { on, spacing, start, size, shell, rd: { [angle]: { tMin, tAvg, note, sMin, sAvg, sNote } } },
plates: { on, rd: { [plate key]: { tl, tr, c, bl, br } } } }` (job step 7). The rules are in `js/floorut.js`, the
screen in `js/views/floorut.js`. `tests/floorut.test.mjs` and the browser check "floor UT" cover them.

## Small tank report — layout reworked for flow (v3.34.0)

The small tank report read as a long run of headings. It is now laid out like the small tank Word template:

- **Page 1 — Inspection summary**: a job information / tank static data grid (client, facility / LSD, area, dates,
  report, job, P.O. and W.O. numbers; tank, serial, manufacturer, year, code, capacity, size, materials and nominal
  thickness), then one summary table whose rows are the template's sections in order — inspection summary (with
  fit / unfit), code required recommendations, non-code recommendations, NDE scope and results, inspection intervals
  (completed / not completed), thickness and corrosion rates. Someone who reads only page 1 has the answer.
- **2 External inspection** (own page) and **3 Internal inspection**: each group's items as one **Item | Condition |
  Comments** table, then only the supporting tables that have readings (floor projections, over-pressure devices,
  settlement and tilt; edge settlement). **4 Insulation** and **5 Follow-up and sign-off** follow on.
- Front matter: the cover, then document control and the contents together on one page; no value key, and no value
  marks in the body (the calculation appendices still give each input's type in words).
- Lighter headings, captions only in the appendices, one-line notes (the method notes are in the calculations
  appendix).

The test tank's body is 3 pages (was 10) and the whole report 14 Letter pages (was 19); the print audit is clean on
Letter, A4, 11 × 17 and portrait. Calculations, the checklist screen and the appendices are unchanged.

## Small tank report — S4: appendices and print (v3.33.0)

The small tank report now ends with its appendices, each printed only when the job has something for it (and each
can be switched off under *Report sections and layout*):

- **Photographs** — two per row in the fixed 4 : 3 frame, captioned *Photo SH-1 · Shell · location · caption*; floor
  indication photos numbered by indication (003a). Photos marked "not in report" are left out.
- **NDE — UT thickness** — the shell UT readings table (the thinnest reading in each course at each station, top course
  first), the nozzle schedule with neck readings at 12, 3, 6 and 9 o'clock, and the fixed roof readings; then two
  drawing sheets: a new **external shell and nozzle UT plan** (`shellPlanSVG`: the shell from above, each UT station with
  its minimum reading, nozzles at their angle in hexagon tags, a nozzle list in the side panel) and the **fixed roof UT
  plan**.
- **NDE — MFL floor inspection** — the indication table (plate, X, Y, MFL %, TS / BS, UT, VT pit, T-actual, repair),
  then the **floor drawing sheet** with the indication list in its side panel (No., X, Y, TS/BS, T-act) — the list
  moves off the sheet when there are more than 22 indications.
- **Calculations** — the five-part layout of the full report's appendices: inputs, assumptions, references (clause
  numbers only), working (CR and RL for the shell and roof, the floor life, the interval formulas with their numbers,
  the planar tilt) and results.
- **Floor minimum remaining thickness (API 653 §4.4.5)** — the full report's floor calculation, when the floor has
  indications.

Tables come before the drawing sheets in each appendix, so an appendix heading never stands alone on a page. Drawing
sheets follow the drawing options (landscape or portrait, report paper or 11 × 17). The test tank prints on 19 Letter
pages; the print audit finds no orphans or split boxes on Letter, A4, 11 × 17 or portrait drawings, and nothing is
wider than the page. The drawing sheet frame gained optional side-panel blocks (`blocks`); full-report output is
byte-for-byte unchanged.

`tests/smallreport.test.mjs` (S4 tests) and the browser check "small tank S4" cover the appendices.

## Small tank report — S3: the report (v3.32.0)

A job on the small tank template now prints the **small tank report** (`js/report/small.js`), in the template's order:

1 Job information · 2 Tank static data (nameplate, materials and nominal thickness) · 3 Inspection summary (the
summary text, fitness for service and the condition of every item) · 4 Code required recommendations · 5 Non-code
recommendations (by the **Code required** tick) · 6 NDE scope and summary of results · 7 Inspection intervals
(recommendations completed / not completed, with dates, or the entered override) · 8 Thickness and corrosion rates ·
9 External inspection (9.1–9.8, each with its condition, comments and tables: floor projections, over-pressure
devices, settlement readings and results) · 10 Internal inspection (10.1–10.7, edge settlement) · 11 Insulation ·
12 Follow-up and sign-off (preparatory work, fit / unfit, inspectors and technicians with certification and a
signature column).

It uses the same frame as the full report: cover (with the job's title, In Service or Out of Service), document
control, contents, value key, page header and footer, DRAFT watermark, issued-report freezing. Chapters run on without
page breaks (the test tank prints on 10 Letter pages); the contents list chapters and sections only. On the Report
screen, *Report sections and layout* shows the small report's order instead of the chapter switches. Every value is
taken from `js/smallcalc.js` (S2). Full-report jobs print exactly as before (golden files unchanged).

`tests/smallreport.test.mjs` checks the order, the code / non-code split, that the thickness, interval, tilt and edge
values equal the calculation, ratings, item tables, sign-off and escaping; the browser check "small tank S3" opens the
report and prints it. The print audit no longer reports the contents page as an orphan.

## Small tank report — S2: calculations (v3.31.0)

The Small tank checklist now calculates (`js/smallcalc.js`, no browser APIs). Results show beside the inputs and
update as readings are typed. No change to the full report or its calculations.

- **8 Thickness and corrosion rates** — floor, shell and fixed roof: T-nom, T-act, years, CR = (T-nom − T-act) /
  years, T-min and RL = (T-act − T-min) / CR, shown as **30 +** when there is no loss or the life is over 30 years.
  The shell row is the course with the shortest life (all courses listed). The floor uses the API 653 §4.4.5
  evaluation the app already makes, **as found** (every repair set to *No*): T-act = RT, CR = StPᵣ + UPᵣ, T-min = the
  governing area's limit, RL = the largest Oᵣ it allows; the life **after the repairs** is shown beside it. Years are
  the tank age from the API 653 page; the shell and roof can have their own.
- **7 Inspection intervals**, each with a due date from the inspection date:
  - API 653: UT thickness §6.3.3.2 (5 years when the corrosion rate is not known, else the lesser of 15 years and
    RCA / 2N), external §6.3.2.1 (lesser of 5 years and RCA / 4N), both from the shell course with the shortest
    life; internal §6.4.2 — the floor Oᵣ, not over 20 years (30 with a release prevention barrier, §6.4.2.2.1).
    *Recommendations completed* uses the floor after its repairs, *not completed* the floor as found.
  - API 12R1: the maximum intervals entered from the user's copy, shortened to the remaining life where that is less.
  - An override (a date or years) is kept beside the calculated value.
- **Settlement (9.8)** — the small-tank planar method from the four stations: height difference across the diameter
  and the low side's bearing; the twist residual ±[(N + S) − (E + W)] / 4 (against the trigger if entered, else
  reported with the Annex B Sₘₐₓ for four stations as reference only); out of plumb from the elevations (tilt × shell
  height) and from the level readings (largest reading scaled to the shell height), the larger compared with API 653
  §10.5.2.1 or an entered limit; the loss of freeboard on the low side; whether the low side is toward the drain.
  With the Annex B basis the full settlement survey is used; with API 12R1 the entered limit (none entered: no pass
  or fail).
- **Edge settlement (10.7)** — each station against the entered limit, within the entered distance of the shell
  (e.g. a company rule), or against Annex B Fig. B.11 (Bew, lap welds taken as parallel to the shell); the Annex B
  value is always shown for reference.
- **Floor projections (9.2)** — each location against API 653 §4.4.5.7 (thickness and width).

**Checks.** `tests/small/small-tank.json` is a 21.5 ft test tank on the small template (built by
`tests/tools/make-small-fixture.mjs`). `tests/smallcalc.test.mjs` checks the rules with worked values;
`tests/handcheck/small_handcheck.py` recalculates the test tank independently from its raw inputs
(`small-export.mjs` exports them): **41 of 41 values agree** (`small-handcheck.md`). The browser check "small tank S2"
types readings and limits on the checklist and checks the results.

## Small tank report — S1: template choice and the checklist (v3.30.0, schema 6)

First of four stages adding a short report for small-diameter tanks (plan: S1 data and screen, S2 calculations,
S3 the report, S4 appendices). Nothing in the printed report changes yet.

- **Report template per job** (Tank setup → Report): *Full API 653 report* or *Small tank report*, and for the small
  report the title, *Out of Service* or *In Service Tank Inspection Report (Small Diameter)*. A new job with a
  diameter under 40 ft shows a suggestion to use the small report; the limit is a device setting (Jobs → This
  device; type feet, or add m / mm). Jobs made before v3.30 keep the full report (job step 6).
- **Small tank checklist** (in the menu when the small template is chosen): one screen in the report's order —
  job information, tank static data (job and P.O. numbers, manufacturer, serial number, capacity, materials), the
  inspection summary, recommendations with a **Code required** tick, the NDE scope, inspection intervals (API 653 or
  API 12R1 rules entered by the user, with overrides), nominal thicknesses, the 16 external / internal / insulation
  items, then follow-up and fitness for service.
- Each item has a Good / Fair / Poor / N/A rating and comments; four have tables: floor projections (N / E / S / W
  thickness and projection), over-pressure devices, tilt stations (shell-base elevations and out of plumb over the
  level) and edge settlement stations (maximum settlement and breakover). What the job already holds for the item
  (shell courses, roof UT points, nozzles, floor indications, the settlement survey, recommendations) is shown with
  a link.
- **Settlement basis** per job: the small-tank planar method (default), API 653 Annex B, or API 12R1 with limits
  entered by the user. Entered limits carry their source as clause or table numbers only: no standards text is
  stored. The twist trigger has no default.
- The **Code required** tick is also on each section's Recommendations page when the small template is chosen.

Data: `job.template` (`''` not chosen, `full`, `small`), `job.small` (title, items, proj, opp, tilt, level, edge,
basis, lim, r12int, intOv, followup, fit, fitNote), new tank fields `maker`, `serialNo`, `capacity`, `matFloor`,
`matShell`, `matRoof` (kept in the registry) and info fields `jobNo`, `poNo`; recommendations gain `code`. The
validator checks the checklist lists' ids and numbers; the revision compare names checklist changes.
`js/small.js` holds the data and `js/views/small.js` the screen; `tests/small.test.mjs` and the browser check
"small tank S1" cover them. Calculation results are unchanged (golden files differ only in the schema number).

## Report improvements — R7: print quality (v3.29.0)

Page breaks were tuned with a new audit tool, `tests/tools/print-audit.mjs` (Playwright and poppler's `pdftotext`):

```
node tests/tools/print-audit.mjs <job.json> [out.pdf] [--a4] [--tabloid] [--portrait]
```

It prints the report and lists pages that print badly: **short** pages (under 35 % full mid-chapter),
**orphans** (a page ending on a section heading or table caption), and **split** result / assessment boxes. Chapter
endings and the page before a drawing sheet are reported separately, as information. (It hides the DRAFT watermark
while printing, so the watermark is not read as page content.)

Run across the seven fixture jobs (one metric), a 1,000-indication tank, A4, 11 × 17 and portrait drawings. Changes:

- Headings, table captions and box titles stay with what follows; table rows, key-value tables, figures, boxes and
  each calculation appendix's result section do not split; a note stays with the table above it; table headers repeat
  on continued pages.
- Drawing sheets close their chapter: the floor plan after the repairs, both roof plans after the rim seal section, so
  the text pages before them are not cut short. The settlement results and edge summary now come before the
  settlement figure page.
- Long sections (repairs, nozzles) may break across pages; the forced break before the rim seal section is gone.

Result: no orphaned headings or captions, no lone note lines and no short mid-chapter pages in any of the test jobs;
the demo report is 54 pages on Letter (was 57), the 1,000-indication tank 145 pages and prints in about 9 seconds.
`tests/r7print.test.mjs` keeps the print rules and the drawing placement in place.

## Report improvements — R6: value marks, results and assessments, photos, deficiencies (v3.28.0)

- **Value marks throughout** (key in the front matter): column headers carry M / C / E / O, and a column that mixes
  sources marks each cell. Remaining thickness is **C** when it comes from a UT reading and **E** when it is nominal
  less the VT pit depth or the MFL estimate (replacing the old V / M superscripts). Specified data (design, set-up,
  limits) carries no mark.
- **Calculated result boxes** in the floor, shell, roof, nozzle and settlement chapters: what the calculation found
  against its limit, and the calculation appendix that holds the working. **Engineering assessment boxes** beside them
  (and for the foundation) print the engineer's words exactly as entered, or "No engineering assessment entered".
- **Photos**: two per row in a fixed 4 : 3 frame (the whole photo shows, annotations stay aligned), captioned
  *Photo FO-1 · Foundation · location · observation 2 (item) · caption*; floor indication photos are numbered by
  indication (001a, 001b …). New appendix **Photo log**: every photo with its component, location, what it is linked
  to (observation, indication, deficiency), caption, and whether it is printed.
- **Deficiencies**: each line says where it came from — the observation (numbered as in the component's observation
  table), a calculated finding of the analysis, or entered directly — and its photo number; priority definitions are
  under the table.
- Tables of 12 or more columns print at 8 px so the marks fit (the indication register is narrower than before).

`tests/r6report.test.mjs`: no old superscripts; every remaining thickness carries the mark for its source; a result
box naming its appendix for each component; no assessment printed unless entered (and an entered one appears only in
its own places); photo captions, the photo log and deficiency sources.

## Report improvements — R5: calculation appendices (v3.27.0)

Every calculation the app performs has an appendix (`js/report/calcapp.js`) in the same five parts — **1 Inputs**
(each value with its type: measured, estimated, calculated, specified, app default or code table, and its source),
**2 Assumptions**, **3 References** (clause, table and figure numbers only), **4 Working** (the formula, the numbers
substituted, the answer, in order) and **5 Result** (the calculated result against its limit, with the engineering
assessment beside it if one was entered):

| Appendix | Calculation |
|---|---|
| A | Floor minimum remaining thickness (§4.4.5) — locations used, rates with the governing location, MFL threshold rate, each auto-repair round, RTᵢₚ / RTᵦc / MRT / t required today / maximum Oᵣ by area |
| B | Annular plate limit (§4.4.6) — Sb, the table row and interpolation, corrosion allowance |
| C | Critical zone limit (§4.4.5.4) — course 1 t-min, the smaller-of rule, the lower bound, any entered limit |
| D | Patch plates (§9.10, §9.11.1) — size per location from the default and the margin, combining, shape |
| E | Shell t-min and fill heights (§4.3.3) — replaces the R4 "working" appendix |
| F | Nozzle necks — nominal and minimum source, loss, comparison with the retirement thickness |
| G | Roof plates (§4.2.1.2) — t-min source, readings below it, holes |
| H | Rim seal gaps — area per gap, per metre of diameter, widest gap, limits and their source |
| I | Settlement (Annex B) — cosine fit, R², tilt, Smax, U and S, arc method, edge results; replaces the R4 "working" appendix |

The appendices use only values the calculations return. Three calculations gained a **trace** for this (the floor
auto-repair rounds and governing locations, the annular table bracket, the parts of the critical-zone rule; the patch
sizes per location). Traces are non-enumerable properties, so results, job files and the golden engineering outputs
are unchanged — the golden calculation files are byte-for-byte identical.

**Checks.** `tests/calcapp.test.mjs` compares every tagged appendix value with the calculation's result for all seven
fixture jobs. `tests/handcheck/` recalculates the demo tank independently in Python (`export.mjs` exports the raw
inputs, `handcheck.py` recalculates and writes `handcheck.md`): 117 of 117 values agree, including a replay of every
auto-repair round.

## Report improvements — R4: shell, roof, nozzles and settlement (v3.26.0)

Each chapter keeps its summary, drawings and results; the long reading tables and the detailed working move to four
new appendices (on by default, reorderable, built by the same code so nothing changes in them):

| Chapter keeps | Moves to the appendix |
|---|---|
| **Shell** — course summary (M / C marks), **§4.3.3 evaluation summary** (nominal, t-min used, minimum reading, maximum product fill and hydrotest height per course, status), roll-out drawing sheet | *Shell UT readings* (the elevation × station grid); *Shell evaluation — working* (material, joint, E, Y, Sd, St, liquid head, t-min calculated, formula notes) |
| **Roof** — fixed and floating roof details, plan drawing sheets, the **points / deck plates below t-min** (or "all at or above t-min, minimum …"), pontoon conditions (O), rim seal results per standard with the source of its limits, visual checklist (O) | *Roof UT readings and rim seal gaps* (every fixed-roof point, every deck plate's 5 readings, the measured seal gaps) |
| **Nozzles** — split into a **schedule** and a **neck UT and evaluation** table (readings M, loss and status C; other readings in their own column; table-default thicknesses still marked T) | — |
| **Settlement** — survey details, plan and cosine-fit figure, shell settlement results (C), an **edge settlement survey summary** (stations surveyed, with edge settlement, acceptable / NDE required / exceeds, highest B / allowable), other edge areas, depressions | *Settlement — working and readings* (cosine fit, U and S by station; B.3.2.2 arc method; edge results by station, profiles and radial readings) |

Chapter notes say which appendix holds the rest. `tests/r4report.test.mjs` checks, for all seven fixture jobs, that
the shell summary (t-min used, minimum reading, fill and hydrotest heights), the nozzle minimum, loss and status, the
roof points and plates below t-min and the edge-survey counts equal what the calculation modules return, and that
each moved table is printed in an appendix.

## Report improvements — R3: the floor chapter (v3.25.0)

The floor chapter (`js/report/floor.js` with `js/report.js`) now has, in order:

1. **Floor summary** — counts and the calculated result (marked C), then **MFL inspection**: scanner and reference
   plate (from the equipment picked for *MFL floor scan*), the scanner's reporting threshold, the MFL threshold used
   for UPᵣ, coverage of bottom and annular plates (full / partial / not scanned, C), the plates not scanned; and the
   indications by prove-up result and area (bottom, annular, critical zone).
2. **API 653 bottom minimum remaining thickness** — as before.
3. **Corrosion and remaining thickness** — product side and soil side (locations, minimum remaining, maximum loss,
   the rate the calculation used and the location or basis that governs it); results by area (bottom, annular,
   critical zone, with the calculation's limits); the 10 locations with the lowest remaining thickness (remaining,
   loss, thickness at Oᵣ, limit, status); minimum remaining thickness by plate.
4. **Floor plan** drawing sheet.
5. **Prove-up — UT and VT** — each proven-up indication: MFL % (E), side, UT minimum (M), UT method, VT pit depth (M),
   the remaining thickness the calculation used and its basis; indications still pending listed separately, saying
   whether the calculation counts them.
6. **Repairs** — repairs and patch plates as before, then **Repair status** for each patch or unpatched repair.

The full indication table moved to a new appendix, **Floor indication register** (on by default; reorder or switch
it off in the report layout).

**Repair status** is entered on Floor → Analysis: proposed / completed / verified, date, contractor, examination
after repair and notes (`job.repairs`, schema 5). Each status is keyed by the indications it covers, so renumbering
patch plates does not move it.

Every number in these tables is a value the calculation returned; `tests/floorreport.test.mjs` checks the worst
locations (choice, order and values), the prove-up remaining thickness, the side rates and minimums and the area
limits against `api653()` for all seven fixture jobs.

## Report improvements — R2: front chapters and schema 5 (v3.24.0)

**Schema 5** (job migration step 4 → 5; a revision of each job is kept before it is updated):

| Group | Fields | Entered on |
|---|---|---|
| Personnel | per person: role, name, company, certification scheme, number, method, level, expiry. Replaces the MFL operator, UT technician and API 653 inspector name fields, which the migration turns into entries | Tank setup → Personnel |
| Calibration | per equipment item: certificate number, reference standard / block, on-site checks (time, check, result) | Equipment → Calibration records |
| Design sources | per design value: nameplate, drawing, previous report, measured or assumed; shell height; previous inspection report | Tank setup |
| Identification | owner / operator, location / area, service | Tank setup → Inspection |
| Scope and limitations | per component: access, cleaning, conditions, areas not inspected and why | each component's NDE page |
| Engineering assessment | overall (the existing condition field) with assessor and date; per component: text, engineer, date | Executive summary; each Analysis page |
| Document control | prepared / reviewed / approved names and dates, distribution list (the peer reviewer stays in the job stage) | Report → Document control |
| Repair status | slot only (`job.repairs`); entry screens come with R3 | — |

`js/personnel.js` holds the personnel model; `personName(job, role)` reads a name from the list, falling back to the
old fields for a job not yet updated. `js/sources.js` lists the design-source options. The validator checks ids in
the new lists; revision comparison and the audit trail label the new parts.

**Report chapters** (`js/report/front.js`):

1. **Executive summary** — a factual scope line; the overall condition as entered, marked as an engineering
   assessment (A), or *No engineering assessment entered*; the component table separates the evaluation result
   (from the calculations and observations, C / O) from the engineer's assessment (A, or *Not entered*); priority
   items; next inspections as entered, beside the floor Oᵣ used in the calculation and the longest Oᵣ it allows (C).
2. **Tank identification and design** — identification, and a design-data table with each value's source
   (*Not stated* when none was recorded).
3. **Inspection scope and limitations** (new chapter) — methods and extent by component, MFL coverage of the floor
   area (C), components not in scope, and access / cleaning / conditions / areas not inspected.
4. **Personnel, equipment and calibration** — personnel with certificate expiry checked against the inspection
   date; equipment; calibration status on the inspection date with certificate and reference standard; on-site
   verification checks; signature lines for the people listed.

Document control prints the prepared / reviewed / approved names and dates and the distribution list. Value-type
marks (M / C / E / O / A) appear in these chapters; R6 applies them to the rest of the report. No calculation
changed (engineering golden results identical apart from the stored job's new empty fields and schema number).

## Report — company page header and footer (v3.23.0)

Jobs page → **Report page header and footer** lets each company make the running header and footer its own:

- six positions — header and footer, each left / centre / right — filled with text and placeholders:
  `{company}` `{client}` `{site}` `{tank}` `{report}` `{rev}` `{status}` `{date}` `{inspector}` `{title}`
  `{page}` `{pages}`. A part between ` · ` separators whose placeholders are all empty is left out (so
  "Tank {tank} · Report {report}" with no report number prints just the tank); an unknown placeholder prints as
  typed, so a typo shows in the preview;
- the company logo in the header (left, centre or right), printed at a fixed height whatever its pixel size;
- colour, text size (6–11 pt) and optional rule lines under the header and over the footer;
- a live preview using the open job (or sample values), and **Reset to default**.

Saved with the company settings (meta `company`, key `hf`) and in backups. Unset, the report prints the original
header and footer. The cover page has no header or footer. Issued reports keep the header and footer they were
issued with.

## Report — drawing sheets (v3.22.0)

The floor plan, shell roll-out and roof plans print as **engineering drawing sheets**:

- a double border with grid references (1–8 across, A–F down);
- the drawing on the left, filling the sheet, with its view title and scale underneath (for example *FLOOR PLAN —
  VIEWED FROM ABOVE*, as shown by the scale bar);
- on the right: **design data** for the view (diameter, thicknesses, plate size, counts, minimum reading …), the
  **legend**, numbered **notes** (the explanatory notes that were under each drawing), and a **title block** at the
  bottom: company and logo, drawing title, client, site, tank, report number, drawn (inspector) and checked (peer
  reviewer), scale, date, **drawing number** (report number + figure, e.g. DEMO-001-F4-1), revision, figure number,
  and DRAFT or ISSUED.

They follow the drawing options: landscape (panel on the right) or portrait (panel below the drawing), on the report
paper or 11 × 17. The settlement plan and chart keep their figure layout.

## Report improvements — R1: the report frame (v3.21.0 – v3.21.1)

The printed report is now a numbered engineering document. Every table, note, drawing and photo it had before is
still in it, and no calculation result changed (the engineering golden tests are unchanged).

- **Front matter:** cover page (company, tank, client, site, report number, revision, DRAFT or ISSUED); document
  control (revision history from the job's file saves and issued report, prepared / peer reviewed / approved
  signature lines); contents; a key to value types (M measured, C calculated, E estimated, O inspector observation,
  A engineering assessment; the marks are applied to values in a later stage) and abbreviations.
- **Numbered chapters** (executive summary; tank identification and design; personnel, equipment and calibration;
  floor; shell; roof; nozzles; foundation and settlement; findings by component; deficiencies and recommendations)
  and **lettered appendices** (plate register, floor indication photographs). Sections are numbered 4.2; tables and
  figures by chapter (Table 4-1, Figure 5-1), listed in the contents.
- **Report sections and layout** (Report screen): switch each front-matter part, chapter and appendix on or off,
  and move chapters and appendices up or down; numbering follows. Chapters with nothing to show for the job are left
  out. Content options (photos, indication sizes, false calls, plate labels, datum marks) are there too. The choice
  is kept on this device; *Default layout* restores the standard order.
- **Pages:** Letter, or A4 (Jobs → Company → Report page size). A running header (company, tank, report number) and
  footer (revision, DRAFT / ISSUED, "Page n of N") on every page but the cover; chapters start on a new page.
- **Drawings** (floor map, shell roll-out, roof plans, settlement plan and chart) each get their own page with a
  numbered figure caption, **landscape** by default or **portrait** (Report sections and layout → Drawing pages), and
  **fill the page**: the drawing takes all the height its heading, legend, caption and notes leave (v3.21.1). The
  floor, shell and roof drawings can go on **11 × 17** (Tabloid / Ledger) pages instead of the report paper; the
  settlement drawing stays on the report paper. Choose 11 × 17 (or Tabloid) in the printer or PDF settings only if
  the printer asks; the PDF carries the page sizes.
- **Full-size print (v3.21.1):** tables now wrap their text to the page width. Before, a table wider than the page
  made the browser shrink the whole report to about 75 %; text and drawings now print at their intended size.
- **DRAFT** watermark until the job is Complete; the issued report has none.
- The page set-up and frame styles are carried inside the report, so an issued report keeps them.

Print with the browser's own "Headers and footers" turned off. Browsers can't put page numbers into a contents list,
so the contents give section, table and figure numbers (each a link in the PDF) and every page is numbered.

## Data integrity upgrade — stage 12: storage, backup reminder and history pruning (v3.20.0)

**Storage on this device** (Jobs page) shows:
- how full the device is, with marks at 70, 85 and 95 %;
- roughly what uses the space: jobs, photos, revision history and the audit trail, and removed photos that revisions
  still show;
- whether the browser keeps the data. *Persistent* means it won't clear it to free space. *Best-effort* means it may,
  if the device runs low; installing the app usually makes storage persistent;
- when this device was last backed up.

**Warnings** appear once each at 70 %, 85 % and 95 % full. At 95 % **new photos are refused**, with the reason, so the
room left goes to readings.

**Backup reminder:** the panel, and a reminder once a day at start-up, when the last backup is older than the
automatic backup interval (14 days if none is set). A device that has never been backed up counts from its oldest job.

**Revision history kept on the device:** each job keeps its newest 15 daily checkpoints and its newest 5 other
revisions. Revisions saved to a job file and issued reports are always kept. Older revisions are removed after each new
one, or with **Tidy revision history now**. They remain in the job files and backups made from them.

**Removed photos:** deleting a photo puts it in the job's bin instead. A revision that shows it can still display it,
and restoring that revision brings it back. Once no kept revision shows the photo, it is deleted for good. Photos in
the bin are not part of the job, its files or its backups.

## Data integrity upgrade — stage 10: overwrite protection and the loader sheet preview (v3.19.0)

**A returned UT loader sheet is previewed before anything changes.** Every reading in the sheet is listed against the
job, grouped by area, with a status:

- **New:** the job has no reading there yet.
- **Changed:** it differs from a reading that isn't verified yet.
- **Conflict:** it differs from a **verified** reading. A reading is verified when the job is at Peer review or
  Complete, or when that value was in a job file saved from this device.
- **Same:** hidden unless you ask to see them.
- **Not in this job:** the item was removed after the sheet was made.
- **Unreadable:** the cell isn't a usable number.

New and changed readings start ticked, and you can untick them. Each conflict needs a choice: keep this job's reading,
use the sheet, or skip for now. **Apply** stays disabled until every conflict has one. "Use the sheet for all
conflicts" asks again first. Blank cells never erase a reading.

On Apply, the app keeps a revision of the job as it was, applies the chosen readings and logs them in the audit trail
(source: Excel loader sheet). It also records the sheet's checksum and every decision. Loading the same sheet again
says when it was loaded before and lists only what still differs.

**Overwrite protection.** Every way a job can be replaced keeps the job as it was in a revision first: opening a file
over it, restoring a backup or a revision, recovering after a close, and applying a loader sheet. Now
**"Overwrite their changes"** (when someone else saved the job file since you last did) also keeps their version on
this device as a revision before the file is overwritten. Their photos are only in their file, so a restored copy of
their version lists any photos that are missing.

## Data integrity upgrade — stage 9: the change audit trail (v3.18.0)

Every change to a job is recorded when it reaches the device: **who** (the inspector name from Settings and this
device's id), **when**, **where it came from**, and each field's value **before and after**. Sources: typed in the
app, a stage change (with the reason when a job is reopened), the Excel loader sheet (with its file name), a job file
opened, a revision or backup restored, changes recovered after an unexpected close, and an app update. Added and
removed items keep their content. File and save bookkeeping (revision numbers, save times) is not logged.

**Audit trail** (in the menu, after Revisions) lists the changes newest first and filters them by section, source and
words in the item or field. **Export CSV** saves what is shown. The screen says whether the trail is intact.

**Tamper evidence.** Each entry carries a checksum of itself and of the entry before it. An entry changed or taken
out of the middle shows on the Audit trail screen and in the database check (Jobs → “Check data on this device”). This is evidence
against accidental or casual changes, not proof against a determined one.

**Job files carry the audit trail.** Opening a file adds its entries that aren't already on this device (entries from
several devices are fine), then a line for the opening itself, with what it changed here. Entries that don't match
their checksum are a warning and are left out.

Recording takes about 20 ms per save for a job with 1,000 indications. Saves happen in the background a moment after
typing stops.

## Data integrity upgrade — stage 8c: the issued report travels in the job file (v3.17.2)

Job files are now **version 2**. A Complete job's file carries its issued report, so it opens on another computer
locked, showing the same report byte for byte. The report's photos are already in the file, so inside the report they
are written as references and put back when the file is opened. That keeps the file from carrying every photo twice.
The checksum proves the report came back unchanged. The file also has room for the job's audit trail (stage 9 fills
it).

When a file is opened:

- an intact issued report becomes the job's issued revision on this device;
- an issued report that was changed, or refers to photos the file doesn't have, is a **warning**. The job opens
  without it and shows the report this version of the app produces;
- an issued report in a job that isn't Complete is not kept (with a warning).

Older (version 1) files open as before. Older versions of the app refuse version 2 files and ask to be updated.

## Data integrity upgrade — stage 8b: Complete freezes the report and locks the job (v3.17.1)

**Marking a job Complete** (from Setup or the Dashboard) issues its report: the report is kept exactly as printed, with
its checksum, the report options and the app version, in an *Issued* revision. The job then shows **Locked** and a
**Reopen** button in the header.

**A locked job is read-only.** On the job's screens the fields and editing buttons are disabled, and the map only
selects. Viewing, filtering, the report, exports and saving to a file still work. A change that gets past the screens
is refused when saving: the stored job is put back and the change is dropped.

**The Report screen** shows the issued report, not a new one. If this version of the app would print the same data
differently (after an update, say), a note says so and **Compare side by side** shows both. The issued report doesn't
change.

**Reopening** (the header button, or moving the job to another stage in Setup or on the Dashboard) asks why. The reason
is kept in the job's stage history and in its revision. Reopen from the header goes back to Peer review, which stays
editable. Marking it Complete again issues a new report; the earlier one stays in Revisions.

## Data integrity upgrade — stage 8a: revisions and the Revisions screen (v3.17.0)

A revision is a complete, checksummed copy of the job kept on this device. Revisions are never changed. One is now kept:

- each time the job is **saved to a file** (with the file's revision number);
- each time its **stage changes** (from Setup, the header or the Dashboard), e.g. *Upcoming → Reporting*;
- when a job file is **opened**, restored **from a backup**, or **recovered** after an unexpected close;
- **before** anything replaces it (a newer file, a restored revision), and before a migration (stage 11);
- once a day, a **daily checkpoint** of the job as it was before the day's first change. It is skipped when the
  newest revision already holds exactly that job.

**Revisions** (in the menu, above Report) lists them, newest first, with who made them, the file revision and whether
the checksum still matches. For each one:

- **Report** shows the report as it was then, read-only.
- **Compare**: tick one revision to compare it with the job now, or two to compare them with each other. The list
  shows each changed field (area, item, field, before and after); added, removed and moved items are matched by id,
  and shell readings by elevation.
- **Restore** puts the job back as it was in that revision. The job as it is now is kept as a revision first, the file
  revision number isn't taken back, and photos that are no longer on this device are reported. A Complete job can't be
  restored until it is reopened (stage 8b).

Old revisions are pruned since stage 12 (the newest 15 checkpoints and 5 others are kept; file-save and issued
revisions always are).

## Data integrity upgrade — stage 7: duplicate imports (v3.16.0)

After its checks (stage 6), a job file is compared with what is already on this device:

- **Already on this device** — the same job with the same data and photos: nothing is imported, and the dialog says so
  (with *Open the job*). If this exact file was opened here before, it says when.
- **A different version of a job that is here** — the same job with different data or photos: the existing question,
  **Replace** (this device's copy is kept as a revision first) or **Keep both**.
- **Possibly the same inspection twice** — no job with this id, but one for the same tank (client, site and tank ID,
  ignoring case and spacing) and the same inspection date: **Add as a separate job**, **Open the one on this device** or
  **Cancel**. Jobs without an inspection date aren't compared.
- Each import is recorded with the file's checksum and what was done: opened, replaced, kept both, added separately,
  opened the existing job, already on this device, cancelled or refused.

## Data integrity upgrade — stage 6: job file checks (v3.15.0)

Every job file is checked before it changes anything on this device (**Open job file…**, the Dashboard's **Open**
for a newer folder copy). The checks run on a copy updated to this version, so an older file is judged the same way.

- **Problems — the file is not opened** (the dialog lists them; nothing on the device changes): not a job file or a
  newer one; missing or wrong-typed parts; an item without an id; two items sharing an id (indications, features,
  nozzles, equipment, shell courses, settlement areas, roof points, seal gaps, NDE methods, observations,
  recommendations, photos) — an edit would change both; text where a number is needed (e.g. MFL % “deep”);
  a photo without image data; a checksum that doesn't match (when the file carries one); a job that can't be
  updated to this version.
- **Things to check — Open anyway or Cancel:** values outside their normal range (MFL % outside 0–100, a thickness or
  size of 0 or less, a negative X / Y, an angle outside 0–360°); an indication or feature on a plate that isn't in
  the floor layout; a photo linked to an indication, section or observation that isn't there; a recommendation
  showing a missing photo; an NDE method using equipment that isn't in the list; two indications with one number;
  a number stored as text (it is converted to a number when the job is stored, because the calculations need one).
- Every attempt is recorded in the device's import log: opened, cancelled or refused, with the number of problems.

## Data integrity upgrade — stage 5: backup and restore (v3.14.0)

**Jobs → Backups** (below the settings):

- **Back up this device…** writes one backup file (`tfi-backup_<date>.tfibackup.json`) with every job on this device,
  its photos, its saved revisions and audit trail, the tank registry and the company settings. Choose where it goes
  (OneDrive, a USB stick — anywhere other than this computer); browsers without the file picker download it. It is
  written a piece at a time, so devices with many photos don't run out of memory.
- **Checksum:** every piece of the file is checksummed as it is written and the file ends with a checksum of those.
  On restore any changed, missing or extra data is found and the file is refused — nothing on the device changes.
- **Restore from a backup…** checks the file, then shows each job in it next to this device's copy: *new* (added),
  *same* (nothing to do) or *differs* (with which copy changed later). For each job that differs, choose **Keep this
  device's copy** (default), **Replace with the backup copy** (this device's copy is kept as a revision first) or
  **Keep both** (the backup copy is added as a separate job). New registry tanks are added; tanks that differ are
  replaced only if ticked; company settings are restored if ticked (ticked when this device has none).
- **One job at a time:** each job is restored in a single transaction. If one fails, that job is left exactly as it was
  and the others are still restored. Restoring the same backup twice changes nothing.
- Saved revisions are never lost: a backup revision already on the device is skipped, and one whose number is taken
  by a different revision is added after the device's last one (its note says so).
- **Automatic backup** (off by default): every 1, 7, 14 or 30 days, to a `_backups` folder inside the jobs folder
  linked on the Dashboard, when the app starts and a backup is due. The newest 5 automatic backups are kept. If the
  browser hasn't allowed the folder this session, the Backups card says a backup is due.
- Every restore is recorded in the device's import log (file, checksum, what was done to each job).
- The backup also covers revisions and audit entries that are not in job files, and is the way back to an earlier
  app version if one is ever needed (an upgraded database can't be opened by an older version).

## Modular refactoring (v3.12.0 – v3.13.0)

Nothing changes for the user: every screen renders the same HTML, and the calculations, job files and
report are unchanged. The shared core of `js/app.js` now lives in `js/app/`:

- `state.js` — the in-memory app state (`S`), the version number and the shared option lists.
- `fields.js` — form field drawing and reading (`field`, `readInput`).
- `nav.js` — the screen registry (`views`, `childViews`, `defineView`) and navigation (`go`, `renderAll`).
- `actions.js` — the button and input registry (`onAction`, `onChange`). Each `data-act` name is
  registered once; a duplicate name stops the app at start-up instead of silently replacing a handler.

Each screen is moving into its own module under `js/views/`, one functional area at a time. A screen module
registers its screen with `defineView` and its buttons with `onAction` / `onChange`; `app.js` imports it once.

| Step | Release | Screens moved |
| --- | --- | --- |
| 2 | v3.12.1 | Report (`views/report.js`), code tables (`views/codetables.js`) |
| 3 | v3.12.2 | Settlement (`views/settle.js`) |
| 4 | v3.12.3 | Fixed roof, floating roof and rim seal (`views/roof.js`) |
| 5 | v3.12.4 | Shell (`views/shell.js`), nozzles (`views/nozzles.js`) |
| 6 | v3.12.5 | Revisions, crash recovery and the data check (`views/history.js`) |
| 7 | v3.12.6 | Dashboard (`views/dashboard.js`); the linked jobs folder (`app/folder.js`) |
| 8 | v3.12.7 | Tank registry (`views/registry.js`) |
| 9 | v3.12.8 | Section screens and equipment (`views/sections.js`), summary and deficiencies (`views/summary.js`); image helpers (`app/images.js`) |
| 10 | v3.12.9 | Tank setup and the floor builders (`views/setup.js`) |
| 11 | v3.12.10 | Indication and plate lists (`views/floorlists.js`), API 653 evaluation (`views/api.js`) |
| 12 | v3.12.11 | Floor map and its editors (`views/floormap.js`) |
| 13 | v3.12.12 | Job files, exports and the UT loader buttons (`views/files.js`) |
| 14 | v3.12.13 | Jobs screen and Settings (`views/jobs.js`); saving (`app/persist.js`) and the header (`app/header.js`); `app/host.js` removed |
| 15 | v3.13.0 | `app.js` is the entry point only; side menu (`app/menu.js`); equipment picker and typed-value listeners moved to their modules |

The refactoring is complete. v3.13.0 renders all 32 screens identically to v3.11.0 (before step 1), and all 15 scripted
edit sequences (463 steps, `tests/tools/scripts/`) give identical job data, registry, photos, settings, downloaded files
and screens.

Screen modules may reuse each other's building blocks (the module tests fail on any import loop, and on any
module that app.js doesn't load). Saving lives in `js/app/persist.js`, which every screen imports directly. Four
redraws one screen asks of another — the floor map, its side panel and mode, and the setup preview — go through
`redraw` in `js/app/nav.js`, registered by the screen that owns them, because a direct import would loop.

## Data integrity upgrade — stage 4: database integrity check (v3.11.0)

`js/integrity.js` checks the device database and lists what it finds; it never changes anything itself.

- **When:** a quick check runs in the background a moment after the app starts and only speaks up if it
  finds something. A full check (which also opens every photo and verifies every revision's checksum)
  runs from Jobs → This device → **Check data on this device**. Since stage 9 it also checks each job's
  audit trail.
- **What:** jobs that can't be read or updated to the current version, values that aren't numbers,
  duplicate indications, indications on plates missing from the layout, links to registry tanks that are
  gone; job list entries that are missing, out of date or have no job; photos whose job is gone (and no
  revision keeps them), damaged images, photos of deleted indications; revisions that no longer match their
  checksum; remembered file links for deleted jobs.
- **Repairs:** safe repairs (rebuild a job-list entry, remove a job-list entry or file link for a job that
  is gone) are offered individually or all at once. Deleting an orphan photo is never automatic and always
  asks first. Everything else, such as a revision that fails its checksum, is reported and left as it is.
  Repairs are logged on the device.

## Data integrity upgrade — stage 3: recovery after an unexpected close (v3.10.0)

On every change the app also keeps a recovery copy of the open job in the browser's local storage
(`js/journal.js`), which is written instantly, and removes it as soon as the change is confirmed on the
device. If the browser or tablet shuts down, the tab is killed, or device writes were failing at the time,
the copy is still there on the next start, and the app asks:

> The app closed before some changes reached this device. TK-101 — 2 changes (Shell), last made … Restore them?

**Restore** puts the changes back; **Discard** keeps the job as it is on the device. Either way, the device
copy is first kept as a revision. Each open tab keeps a heartbeat, so changes still being saved in another
open window are never mistaken for a crash. Photos are written to the device straight away and are not
part of the recovery copy. If the browser refuses the recovery copy (storage full), the app says so once and
carries on saving normally.

## Data integrity upgrade — stage 2: unsaved change detection (v3.9.0)

The header shows two separate things:

- **Saved on this device** (right-hand corner): *Saving…*, *Saved locally*, or *Not saved — retrying*.
- **The job file** (next to the job title): *Rev 3 · 4 changes not in the file*, or *Not saved to a file · 4
  changes*. Hover for the areas changed (Floor, Shell, Roof, Nozzles, Settlement, Tank setup, Equipment,
  Findings and report). Saving the file clears the count.

Changes made while a file is being written are not in that file, so they stay counted (this also fixes an
older race where such a change could look as if it had been saved to the file). The Jobs list shows the same
count for every job. Closing the app asks first only while a change is not yet on the device; everything
already saved on the device is safe to close without asking.

## Data integrity upgrade — stage 1: reliable automatic saving (v3.8.0)

Every change is still written to the device about a third of a second after it is made, now through a
save queue (`js/saver.js`):

- **One write at a time.** A change made while a write is in progress is written straight after it, so
  writes never overlap and the last value always wins.
- **On disk before "Saved".** Job writes ask the browser for strict durability, so "Saved locally" means
  the data has reached storage, not just memory.
- **Never silent.** A failed write shows **Not saved — retrying** in the header (also on small screens) with
  the reason in plain words (for example a full device), and is retried after 1, 3 and 10 seconds; after
  that, the next change or **Try again** retries. The change stays on screen and is never dropped.
- **Nothing is left behind.** While a change is not on the device, opening another job, editing a registry
  tank, writing a job file and making a UT loader sheet are refused with an explanation, so a job file is
  never written from out-of-date data.

## Data integrity upgrade — stage 11: migration management (v3.7.0)

Database and job migrations are now ordered, numbered steps (`js/migrations.js`), logged on the
device (Settings → This device shows the database version and the log).

- **Database version 4** adds three empty, append-only stores — `revisions`, `audit`, `imports` — and
  rewrites no existing record. All steps from the stored version run in one upgrade transaction; if a
  step fails, the browser rolls the upgrade back, the old database is kept, and the app says so.
- **Job schema 4**: steps 1→2 (plate X / Y), 2→3 (calculation review) and 3→4 (history fields) run in
  order on a copy of the job, so a failing step leaves the stored job untouched and the job is not opened.
- **Revisions**: on the first start after the upgrade every existing job gets one baseline revision (the
  job exactly as stored, with a SHA-256 checksum). Before a stored job is migrated, a revision of it as it
  was is kept. Revisions are never changed.
- **Inspector name** (Settings → This device) is recorded with each revision.
- Job files: v3.6.0 and older files open as before. Jobs saved by v3.7.0 are schema 4, so an older
  installed app asks to be reloaded before opening them.

## Calculation corrections (v3.6.0)

v3.6.0 applies the 28 approved items of the November 2026 calculation review (C-01 to C-31), checked
against API 653 5th ed. Addendum 4 (2025), API 650 (2021), Canada SOR/2025-88 and 40 CFR 60 Subpart Kb.
The report footer names the corrections in force so reports issued before and after can be told apart.
Results for existing jobs can change; opening an older job says what was updated.

- **Floor (§4.4.5):** repaired soil-side areas keep their rate in UPr unless "cause of corrosion removed"
  is ticked, and only welded repairs remove a location from RT; UPr includes the MFL threshold (default
  20 % of nominal, Note 1); the critical-zone limit is the smaller of 0.118 in (3 mm) and ½ course 1
  t-min, not less than 0.10 in (2.5 mm), with any entered limit needing a reason; a location is critical
  when its recorded extent reaches the zone; results on MFL estimates are shown as provisional; no rate
  basis gives "not evaluated"; recorded product-side pitting keeps StPr on a coated floor unless the
  engineer confirms the coating basis; Oᵣ over 20 years (30 with an RPB) is flagged (§6.4.2.2.1); the
  rate basis is the tank age, with an optional separate StPr basis; impossible inputs are refused.
- **Annular plates (§4.4.6):** the limit defaults to the Table 4.5 / API 650 Table 5.1 value plus any
  corrosion allowance; Table 5.1 is not used beyond H × G = 75 ft or a 1.75 in first course.
- **Patches (§9.11.1):** added §9.11.1.2 h) spacing, i) 24 in along the shell and §9.11.1.2.2; g) applies
  only to shells of unknown toughness; the "2 in past the corrosion" check needs the corrosion size.
- **Settlement (Annex B):** B.3.2.2 arc results are for information only; with a valid fit the arc
  deflection is measured from the tilt plane; fold-pattern option (B.2.2.5.3); Si / Smax use a subset
  spaced ≤ 32 ft when extra stations are taken (B.2.2.4 NOTE); one documented Y and the material's E;
  tanks under 20 ft use the 20 ft edge curve with a note for engineering review.
- **Shell:** single readings are compared with the t-min at their elevation (§4.3.3.1 b) and evaluated
  per §4.3.2 (below 60 % of t-min fails); CSA G40.21-13 grades added; metric jobs use the SI equations.
- **Nozzles, roofs, seals:** nozzle necks pass only against an engineer-entered retirement thickness;
  a roof reading of 0 records a hole through the plate (§4.2.1.2); SOR/2025-88 external-roof shoes need
  60 cm above the liquid; the US check is labelled Subpart Kb (Subpart Kc not covered); citations follow
  the 2025 numbering; bottom projection beyond the shell is checked (§4.4.5.7).

## Equipment (v3.4.2)

- **Equipment** (side menu, under Tank setup) is the job's equipment list: type, make, model, serial no.,
  calibration date, calibration due, settings / details (and the reporting threshold for an MFL scanner).
  Calibration due before the inspection date shows **Expired**; within 30 days shows *Due ≤ 30 days*.
  Items can be duplicated (e.g. a second probe) or copied from another job.
- On each section's **NDE** page every method has an **Equipment** picker. Choosing a method picks matching
  items automatically (MFL floor scan → MFL scanner + reference plate; UT thickness → gauge, probe and block;
  VT → visual tools; level survey → level), one per type; adjust as needed.
- The report's *Equipment and personnel* lists the equipment picked under the NDE methods with serials,
  calibration and what each was used for, and each section's *NDE performed* table shows the equipment per method.
- Older jobs: the old MFL / UT equipment form is converted into list items and matched to the NDE methods.
  The UT loader sheet reads and writes the UT instrument and probe from the list.

## Tank registry (v3.4)

Enter each tank once, then start every inspection from it.

- **Tank registry** (side menu) lists tanks by client → site. **Add tank** opens the tank data editor:
  identity (client, site, tank ID, location), construction and design, floor layout, floor features and
  patches, nozzles, shell courses, roof and settlement set-up. Changes save automatically; **Done** returns
  to the registry. Readings entered while editing a registry tank are not kept.
- **New inspection** on a tank asks for the **scope** (Floor, Shell, Fixed roof, Floating roof, Nozzles,
  Foundation, Settlement) and the **floor layout** to start from:
  - *As found at the last inspection* — the previous job's layout, plate corrections and patches;
  - *Registry layout* — the floor as stored for the tank;
  - *New floor* — a blank layout when the floor has been replaced (tank, shell and nozzles are kept).
  It also takes the planned date, report due, report no., work order, inspector and product, and can copy
  the MFL / UT equipment from the last inspection. Product, specific gravity, fill height and operating
  temperature are per inspection (pre-filled from the last one).
- Each inspection keeps **its own copy** of the tank data, so finished reports never change. On **Tank
  setup** the *Scope & registry* card shows whether the job differs from the registry and offers
  **Update registry from this inspection** (e.g. after recording new patches or a corrected layout).
- Sections outside the scope are hidden from the menu and left out of the report. Older jobs have no
  scope and show everything; the scope can be changed on Tank setup at any time.
- **Build registry from jobs** (shown when there are unlinked jobs) creates one tank per client + site +
  tank ID from the most recent job and links all of them.
- **Tank builder (v3.4.1)** — Tank setup (and the registry tank editor) now builds the whole tank on one page:
  - **Shell**: courses from the bottom up with height, nominal t and plates — number of plates or plate
    length — and the **first vertical seam located from the 0° datum**, either as a distance around the shell
    or as an angle (enter one, the other follows). *Copy course 1 plates up* fills empty courses. A shell
    roll-out under the table shows plates, seams and nozzles.
  - **Nozzles**: a design table (mark, type, connection, angle or distance from the datum, size, elevation,
    schedule, wall, service). **Place on the floor drawing…** opens the Floor map in nozzle mode to click
    nozzles in around the shell.
  - The floor drawing and preview show the nozzles outside the shell and the **bottom-course shell seams**
    as short orange marks across the shell line.
- Saved job files carry their registry tank, so opening a job file on another device adds the tank there.
  Sharing the registry itself through the jobs folder is planned for v3.5.

## Dashboard (v3.3)

The app opens on the **Dashboard**: every tank on this device and in the linked jobs folder, in five columns —
**Upcoming → Inspection ongoing → Reporting → Peer review → Complete** — with a count tile for each stage.

- **Link jobs folder…** — pick the shared folder (e.g. the team's OneDrive jobs folder). The app reads every job file
  in it (and two levels of subfolders, e.g. one per client). The browser asks again each session — click **Reconnect**.
- **Move a tank** — drag its card to another column, or use the stage list on the card. The change is saved on this
  device *and written into the job file in the folder* (without bumping the revision), so the rest of the team sees it
  on their next rescan.
- Each card shows tank, client / site, planned or inspection date, report due date (red when overdue), inspector and
  peer reviewer, overall condition, open deficiencies (P1/P2 flagged), and where the job lives (this device, folder,
  or both — "Folder copy newer" if someone saved a later version).
- **Open** loads the job; if the folder copy is newer it is imported from the file.
- **List** view shows the same tanks as a table; the search box filters by tank, client, site, report number or names;
  click a stage tile to show only that stage.
- Stage, peer reviewer, planned inspection date and report due date are also in **Tank setup → Inspection**, and the
  current stage is shown next to the tank name in the top bar. Each stage change is recorded with its date.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `tank-floor-inspector`).
2. Upload the contents of this folder to the repository root (drag the files into
   **Add file → Upload files**, or `git push`). Keep the folder structure: `index.html`, `sw.js`,
   `manifest.webmanifest`, `.nojekyll`, `css/`, `js/`, `icons/`.
3. In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*,
   pick `main` and `/ (root)`, and save.
4. After a minute the app is live at `https://<user>.github.io/<repo>/`.
5. Open it in Chrome or Edge and click the install icon in the address bar (or the
   **Install app** button) to install it as a desktop app.

All paths are relative, so it works from a project sub-path. Pages serves over HTTPS, which the
service worker needs.

**Publishing updates:** after changing any file, bump `CACHE` in `sw.js` (e.g. `tank-floor-v1.0.1`).
Installed copies pick up the new version and show a *Reload* prompt.

**Local testing:** service workers need `http://localhost` or HTTPS, so run
`python3 -m http.server 8000` in this folder and open `http://localhost:8000`.

## Automated tests

The tests live in `tests/` and run on every push (GitHub Actions, `.github/workflows/test.yml`).
Nothing in `tests/` or `package.json` is used by the app, which still has no dependencies.

- `node --test tests/*.test.mjs` — **golden tests**: every engineering result (floor layout,
  API 653 MRT and repairs, patches, shell t-min and evaluation, nozzles, settlement, roof and rim
  seal, CSV exports) and the full report HTML for seven fixture jobs must match the outputs recorded
  from v3.4.2. Plus checks that `sw.js` lists every file, and that the calculation modules don't
  touch the page.
- `node tests/browser/run.mjs` — browser checks with Playwright (`npm i --no-save playwright` and
  `npx playwright install chromium` first): every page renders, user text can't run as script,
  storage is all-or-nothing, save conflicts, the service-worker update, pinch zoom, and more.
- `tests/modules.test.mjs` (part of the Node run) — every module parses, every import matches an
  export, no undefined names (ESLint, `npm i --no-save eslint@10` first), and the offline cache lists
  every module.
- `node tests/tools/report-content-diff.mjs` — checks that every table cell, paragraph, heading, drawing and photo in
  the recorded report of each test job is still in the report the code builds now. Run it before re-recording the
  report golden files.
- `node tests/tools/print-audit.mjs <job.json>` — prints a job's report and lists pages that print badly (R7).
- `node tests/tools/screens-diff.mjs <old copy> <new copy>` — renders every screen with the demo tank in
  two copies of the app and reports any difference in the HTML. Used to confirm a refactoring step
  changes nothing on screen.
- `node tests/tools/actions-diff.mjs <old copy> <new copy> <script>` — runs a scripted sequence of edits
  (`tests/tools/scripts/`) on both copies and compares the job data, registry and photo records, downloaded files, screen and focus after every step
  (fixed clock, repeatable ids). `for t in $(ls tests/tools/scripts | sed 's/.mjs//'); do …; done` runs them all.
- After a deliberate, reviewed change to a calculation or the report, re-record the golden outputs
  with `UPDATE_GOLDEN=1 node --test tests/*.test.mjs` and review the diff before committing.

## Repairs

Open an indication (Floor → NDE → Indications, or click it on the floor map) and fill in **Repair & remarks**:
Repair (auto / yes / no), Repair method, **Repair / patch plate length and width**, **Patch plate thickness**
and a **Repair ID** (e.g. P-1; use the same ID when one patch covers several indications). The report's
Repairs table lists the repair / patch size (L × W × t) and, optionally, the indication size (report option
*Indication sizes*; the indication length and width are optional and the column is left out when none are
entered); the CSV includes them. Existing patches already on the floor are drawn with the floor feature *Patch plate / repair*
(Floor map → + Feature).

### Auto patch

Every indication that needs repair (auto from the API 653 calculation, or Repair = Yes) gets a lap-welded
patch plate, unless its repair method is something other than a patch. Settings on Floor → Analysis
(API 653): **Auto patch repair indications** (on), **Default patch length / width** (12 × 12 in), and
**Extend past the corrosion by at least** (2 in, API 653 9.10.1.1 b) — a patch grows beyond the default
when the indication is bigger — and **Patch plate thickness** (1/4 in unless entered on the indication). Patches are centred on the indication; overlapping patches, and indications given the same
Repair ID, are combined into one patch. They are numbered P-1, P-2 … (a Repair ID you type is kept).
A size typed on the indication overrides the auto size. Patches are drawn on the floor map (toggle
*Patches*; small patches are drawn at a minimum size with the true outline inside so they show on a large
tank) and in the report, which also lists them in a *Patch plates* table with size, thickness (nominal
bottom t unless entered), the indications covered, plates, and a flag when a patch reaches the critical zone.

**Critical zone patches (API 653 9.10.1.2).** A patch that would come within 6 in of the shell becomes a
**tombstone** patch: it is turned so its sides run radially and meet the shell-to-bottom joint at 90°, and
it extends to the shell (L measured radially from the shell, W along the shell). Each critical-zone patch
is checked: thickness not over 1/4 in (and API 650 4.2.10 toughness); tombstone shape within 6 in of the
shell; at least 2 in past the corrosion; fillet welds at least the greater of 3 in or 5t from the course 1
vertical seams; not over or butt-welded to an existing patch (floor features of type patch); operating
temperature not over 200 °F / 93 °C (Tank setup → *Max. operating temperature*); and the items to verify in
the field — bottom plate under the perimeter weld at least 0.10 in, and a two-pass perimeter weld examined
by MT / PT. The result (OK / Verify / Fails) shows in the indication editor, on the API 653 page, in the
report's *Critical zone patch plates* table and, when a patch fails, as a suggested recommendation.

## Organisation of the app (v3)

The sidebar follows the parts of the tank:

- **Jobs**, **Tank setup** (inspection details, tank, construction & design, floor layout, equipment) and
  **Executive summary**.
- **Floor, Shell, Fixed roof, Floating roof, Nozzles, Foundation, Settlement** — each opens to five pages:
  - **NDE** — set up the NDE methods (method, extent, procedure, technician, date, result, notes; *Add
    typical methods* fills in the usual ones) and enter the readings on the data pages, shown as tabs and
    as a sub-list in the sidebar (Floor: Floor map / Indications / Plates; Shell: Shell UT; Fixed roof: Fixed
    roof UT; Floating roof: Deck & pontoons / Rim seal; Nozzles: Nozzle UT; Settlement: Settlement survey).
  - **Observations** — item, location, condition (good / fair / poor / not inspected) and the observation;
    *Add typical items* gives a checklist for that part of the tank; *Make a recommendation* turns an
    observation into a recommendation.
  - **Photos** — add photos (camera on a tablet / phone), caption, comment, link to an observation, choose
    whether it goes in the report, and **annotate** with arrows, circles, boxes, freehand and text in six
    colours. Annotations are stored as drawings over the photo, so the original is kept. Photos are numbered
    by section (FL-1, SH-1, FO-1 …).
  - **Analysis** — the calculated results and the automatic findings that need action (Floor: API 653
    bottom MRT; Shell: API 653 4.3.3 evaluation; roofs: readings and rim seal compliance; Nozzles: neck
    evaluation; Settlement: summary with a link to the full survey; Foundation: observation summary).
  - **Recommendations** — *Suggested from the analysis* lists the findings with a priority (P1 Immediate,
    P2 Before return to service, P3 Within 12 months, P4 Next scheduled inspection, P5 Monitor /
    maintenance); add them one at a time or all at once, or write your own. Each has the finding, the
    recommended action, location, code reference, due date, status, a linked photo and a *Deficiency* tick.
  - A coloured dot shows each section's condition: green satisfactory, amber attention, red deficient.
- **Deficiencies** — every recommendation ticked as a deficiency, numbered D-001, D-002 … across the whole
  tank. Filter open / closed / all, update priority, due date, status and client comment; status changes are
  date-stamped. *Issue update* stamps the issue date and update number and opens the printable
  **Deficiency report** for the client (Print / Save PDF); *Export CSV* for spreadsheets.
- **Executive summary** — overall condition, return to service and next inspection dates, a condition table
  by component (from the data), scope and summary of findings (with *Draft* buttons that write a first draft
  from the NDE set-up and the findings), and the P1 / P2 items.
- **Code tables** and **Report**. The report starts with the executive summary and the deficiency list, then
  the technical sections, then *inspection findings by component* (NDE performed, observations,
  recommendations and annotated photos). Each part can be turned off in the report options.

## Where the data lives — job files and OneDrive

Jobs are kept in the browser's storage (IndexedDB) on the computer that entered them, so the app
works with no connection. To move a job to another computer or share it, save it as a **job file**:
one `.json` file holding all the job data and its photos.

- **Save file…** (top bar, or **Ctrl+S**) — in Chrome or Edge you choose where the file goes; pick a
  folder inside your OneDrive (or SharePoint / Teams synced folder). After that, **Save** / Ctrl+S
  updates the same file, and OneDrive syncs it. **Ctrl+Shift+S** or *Export → Save job file as…*
  saves to a new file. Other browsers download the file instead; move it into OneDrive yourself.
- **Jobs → Open job file…** — on another computer, open the file from the synced OneDrive folder.
  If that job is already on the computer, the app shows which copy changed last and asks whether to
  replace it or keep both.
- **Revision number:** every save to a file is a new revision (Rev 1, Rev 2, …) stamped with the
  date and time. The top bar shows the current rev and turns amber with *unsaved changes* when the job
  has been edited since. The Jobs list, the report header and footer, and the open-file prompt show
  the rev, so you can tell which copy is newer.
- The app does not merge edits, so only one person should edit a job at a time: open the latest
  file, work, save, then the next person opens it.
- **Save conflicts (v3.5):** before Save overwrites a job file, the app checks that nobody else has
  saved it since this computer last opened or saved it. If someone has, it shows both revisions and
  asks: **Save mine as a copy** (keeps both), **Open their version**, **Overwrite their changes** or
  Cancel. Overwriting keeps their version on this device as a revision first (v3.19). A stage change made from a teammate's Dashboard is not a conflict: it is merged into your
  save instead of being overwritten.
- A job file saved by a newer version of the app is refused with a message to reload and update, so
  an older installed copy can't re-save it and lose the newer data. Older jobs opened in a newer
  version are updated, and the app says what changed (e.g. the API 653 patch margin).
- Clearing the browser's site data deletes jobs that haven't been saved to a file. The app asks the
  browser to keep its data permanently, warns at 70, 85 and 95 % full, and refuses new photos at 95 %
  (Jobs → *Storage on this device*). **Back up this device** (Jobs page) saves every job, photo, revision
  and audit entry in one file.
- **History on the device (v3.17 – v3.20):** each job keeps revisions (Revisions screen: compare, view the
  report as it was, restore) and an audit trail of every change (Audit trail screen). A Complete job is
  locked with its issued report frozen; Reopen asks for a reason. See the *Data integrity upgrade* sections
  at the top.

## Workflow

1. **Jobs → New job** (or **Load demo tank** to explore).
2. **Tank setup** — inspection details, units (ft/in or m/mm), diameter, nominal bottom and annular
   thickness, plate width/length, row direction, stagger, annular ring and plate numbering. The
   layout preview updates as you type.
3. **Floor map** — press **N** (or *+ Indication*) and click the plate where the MFL call is. The
   app fills in the plate and X/Y; type the measured offsets to correct them. Shift-click places
   several in a row. Click a plate to set its scan coverage (scanned / partial / not scanned),
   nominal or measured thickness and label. *+ Feature* adds sumps, roof columns, patch plates,
   nozzles and manways.
4. For each indication enter the MFL signal and % loss estimate, then the prove-up: result
   (product side, soil side, both, no indication, other), UT minimum remaining, VT pit depth,
   condition, coating, and photos.
5. **API 653** — set Oᵣ, rate basis, minimum thickness limits, coating/CP options. Review the
   results and the repair list.
6. **Report** → *Print / Save PDF*, and **Export** for CSV (opens in Excel), SVG/PNG map, or backup.
7. Move the job through the stages (Setup or the Dashboard). Marking it **Complete** issues the report:
   it is frozen as printed and the job becomes read-only until it is reopened with a reason.

## Building the floor: automatic grid or row by row

**Tank setup → Plate layout → Layout method**

- **Automatic grid** — standard plates in staggered rows across the whole floor, edges cut to the shell.
- **Row by row** — the Floor builder lists the floor as sections stacked from the top of the drawing
  (or from the left when rows run top – bottom):
  - **Row** — a strip of plates one plate-width wide. Enter **how many plates are in the row**: the
    middle ones are full-length plates and the two end ones are sketch plates cut to the shell. A
    *fits N* hint shows the count that suits that chord. Optional plate length and offset (stagger).
  - **Block** — full-length plates laid across the rows, e.g. **several full-length vertical plates in
    the centre**. Enter the number of plates and their width; the block depth is the plate length.
    The gaps between the block and the shell on each side are filled with sketch-plate rows (row
    width × plates per row), labelled e.g. GL1, GL2… / GR1, GR2….
  - **Start from** *Standard rows* (one row per plate width, counts worked out for you) or
    *Centre block + sketch plates* (a vertical block in the middle with sketch-plate rows above,
    below and beside it), then adjust counts. Insert, delete and reorder rows; *Shift all rows*
    moves the whole stack. The builder warns if part of the floor isn't covered.
  - **Add plates from the map:** click any plate and use the **− / +** buttons to change the number
    of plates in its row or block.
- **Plate by plate** — for floors you have measured. Each row lists its plates in order with their
  **length × width**; plates are laid end to end and centred on the floor (Offset slides them), and
  end plates longer than the floor are cut at the shell. Each block lists its plates' **width ×
  length** side by side, with sketch-plate rows filling the gaps beside it. Blank sizes use the row
  width / standard length (or block depth). *Copy from automatic / row-by-row layout* fills every
  row with the sizes from the current drawing so you only correct the numbers; **+ Plate** copies
  the previous plate's size. Each row shows its total length against the floor width there and
  flags plates that end up outside the shell. On the Floor map, click a plate to edit its length
  and width, insert a plate before or after it, or remove it.
- When a layout change removes the plate an indication or feature was on, it is moved to whichever
  plate now covers that spot (X/Y recalculated from the new plate's datum).

## Plate sizes and orientation

Tank setup holds the **standard** plate width, length and orientation used to generate the floor.
Any bottom plate can have its own measured **length**, **width** and **orientation** (horizontal =
length runs left–right on the drawing, vertical = top–bottom). Click the plate on the Floor map, or
use the Length / Width / Orientation columns on the Plates page. A measured plate is redrawn from its
datum corner on the standard grid and drawn on top of the neighbouring plates, so its indications
stay where they were measured. Blank fields fall back to the standard size; *Reset to standard size*
clears all three. The plate register and plate CSV list each plate's size and orientation.

## Shell nozzles

Nozzles, manways, inlets/outlets, water draws, clean-out doors and other shell openings are located
by **angle around the shell** (clockwise from 0°), not by plate. Add them on the Floor map with
**+ Nozzle** and a click at the shell (the angle is taken from the click, to the nearest 0.5°; hold
Shift to add several), or type them into **Tank setup → Shell nozzles**. Each has a mark (N1, MH1,
CO1… numbered automatically by type), type, angle, size, elevation to centreline and service. They
are drawn outside the shell on the map and report, listed in a nozzle schedule in the report, and
exported with *Export → Nozzle schedule (CSV / Excel)*. Click a nozzle on the map to edit it.

Each nozzle also records its **connection** (raised face weld neck, threaded NPT, slip-on, socket
weld, flat face, other) and **neck UT**: schedule, nominal wall, required t-min, readings at 12, 3,
6 and 9 o'clock (looking at the nozzle from outside the tank) and any number of extra readings with
your own location labels (*+ Reading* in the nozzle panel). The app shows the minimum reading, %
wall loss against nominal and *OK* / *Below t-min*; nozzles below t-min are drawn red on the map
and highlighted in the nozzle table, report and CSV. The four clock readings can also be typed
straight into the Shell nozzles table in Tank setup.

## Shell UT and roll-out

The **Shell UT** page records shell thickness readings:

- **Shell courses & plates** — course 1 at the bottom; height, nominal thickness and t-min
  (minimum required thickness, entered by you). For the roll-out, each course has a **plate count**
  (equal plates) or a **plate length** (full plates from the first seam, last one the closure
  plate) and the **angle of its first vertical seam**. Blank first seam staggers alternate courses
  by half a plate; blank plate count suggests ≈ 30 ft plates.
- **UT stations** — the standard count is the circumference ÷ 32 ft, rounded down, **minimum 4 and
  maximum 8**, equally spaced from 0° (a 30 ft tank gets 4, 60 ft gets 5, about 82 ft and larger 8).
  Override the count or the first station's angle if needed.
- **Reading elevations** — set by zones, each a reading every *step* from *start* to *end* above
  the bottom (blank end = top of the shell). The standard pattern is **every 1 in from 1 in to
  2 ft, then every 1 ft from 3 ft to the top**. Add, edit or remove zones, or add single extra
  elevations. Every station gets a reading at every elevation.
- **UT readings** — a grid of elevations (grouped by course, bottom to top) × stations. Tab moves
  across; **Enter moves up the same station** (Shift+Enter down). Readings below the course t-min
  are red; each course shows its minimum, % loss against nominal and OK / Below t-min. Readings
  are stored by station angle and elevation, so changing the pattern keeps readings already taken.
- **Shell roll-out** — drawn like a fabrication drawing: the shell unwrapped from 0° to 360°
  looking from outside, each course drawn as **whole plates** with circled plate numbers (plates that
  cross 0°/360° overhang both ends), UT station lines with the angle circled at the top,
  arc-length dimensions between stations along the top, course and overall height dimensions on
  the right, the circumference along the bottom (ft-in to 1/32" with [mm]), and shell nozzles as
  symbols at their angle and elevation with hexagon tags (manways as double circles). Drawn to
  scale; very wide, short shells have their height stretched (noted on the drawing).
- The report has a Shell UT page (roll-out and course summary) and a **Shell UT readings** table of
  every elevation and station. *Export → Shell UT readings (CSV / Excel)* and *Shell roll-out (SVG)*.
- Readings entered in v2.0 (one per course) are kept at mid-height of their course.

## Roof

The **Roof** page records the roof. Pick the roof type: *Fixed roof*, *External floating roof*, or
*Fixed roof + internal floating roof* (both sections show).

**Fixed roof** — roof (cone, dome, umbrella, aluminium dome), support (column, self, rafter
supported), slope / dome radius, nominal plate thickness and t-min (default 0.09 in, API 653
§4.2.1.2 — check your edition) and notes. UT points are located by **angle and distance from the
centre**: type them in, click **+ Point on plan** and click where the reading was taken, or use
**Standard points** (edge and mid-radius on each shell UT station line, plus the centre). The plan
shows the shell UT station lines, roof support columns from the floor map, and each point with its
reading (red below t-min).

**Floating roof** — roof type (single-deck pontoon, double-deck, internal pan / pontoon /
aluminium), rim gap (roof diameter = shell − 2 × rim gap), pontoon ring (radial width, number of
pontoons — about one per 10 ft suggested — and the angle of the first bulkhead), deck plate size,
direction and stagger, and deck nominal / t-min. The plan draws the
pontoons (P1, P2…) and the deck plates (A1, A2…, laid like the floor grid and cut at the pontoon
ring).

**Each deck plate has 5 UT readings — the four corners and the centre** — drawn as dots on the plan
(green OK, red below t-min, hollow not read). Click a plate on the plan to enter its readings in a
corner-and-centre panel (‹ › steps to the next plate), or type them into the deck plate table.
**Pontoons have no UT readings**; each records a condition (dry, liquid present, leaking, not
accessible) and notes, and pontoons with liquid or leaking are shaded on the plan. Readings are kept per plate position, so if the
layout is changed the app warns about readings on plates that no longer exist.

The report has a Roof section (details, plan drawings, point / plate reading tables and pontoon
conditions); *Export → Roof UT readings (CSV / Excel)*.

### Rim seal inspection (floating roofs)

Below the floating roof is a **Rim seal inspection** that evaluates the seals against one or more
standards at once:

| | US EPA — 40 CFR 60 Subpart Kb / 63 Subpart WW | Canada — SOR/2025-88 |
| --- | --- | --- |
| Primary seal gap area | ≤ 212 cm²/m of diameter (10 in²/ft) | < 200 cm²/m |
| Primary seal widest gap | ≤ 3.81 cm (1.5 in) | < 4 cm |
| Secondary seal gap area | ≤ 21.2 cm²/m (1 in²/ft) | < 20 cm²/m |
| Secondary seal widest gap | ≤ 1.27 cm (0.5 in) | < 1.3 cm |
| Mechanical shoe | top ≥ 61 cm (24 in) above liquid, bottom in liquid (EFR) | ≥ 30 cm high, ≥ 10 cm above and below liquid |
| Gap probe | 0.32 cm (1/8 in) | 0.3 cm |
| Frequency (EFR) | secondary annually, primary every 5 years | secondary annually, primary every 5 years (API 653 inspector), monthly roof visual |
| Frequency (IFR) | annual visual through hatches; internal every 10 years (no gap limits) | monthly LEL; internal incl. seal gaps every 20 years |
| Repair | 45 days (+30-day extension) | 60 days (90 days if total gap < 1000 cm²/m); IFR 15 days temporary vapour control, 180 days repair |

A third **Custom / provincial approval** set takes the limits from the 1995 CCME guideline
(PN 1180) or a provincial approval — enter them; the app does not supply CCME values.

For each seal record the type (mechanical shoe, liquid-mounted, vapour-mounted; rim-mounted or
shoe-mounted secondary), shoe dimensions, notes, and each **gap**: start angle, length along the
shell, maximum width and (optional) average width. Gap area = length × average width (maximum width
if no average); area per metre of tank diameter = total ÷ diameter. Tick *No gaps found* when the
probe found none. A visual checklist covers roof floating freely, liquid on the deck, holes / tears,
detached seal, secondary seal coverage, fittings, drains, obstructions and rim submergence. Each
standard shows a pass / fail table, the repair requirement if anything fails, and the next due
dates from the inspection date. Gaps are drawn on the floating roof plan (primary red, secondary
blue). The report has a Rim seal inspection page; the roof CSV includes the gaps and results.

Limits are from 40 CFR 60.113b, 40 CFR 63.1063 and SOR/2025-88 (ss. 64–65, 73–76, 91–101,
Schedule 4) as published in 2025–2026. Check them against the rules, permit or approval that apply
to the tank and the product stored.

### Code tables, materials and shell evaluation

The reference tables come from the inspection workbook (AcuTank) so the app uses the same values. They
are shown read-only on the **Code tables** page:

- **API 653 Table 4.1 materials**: minimum yield and tensile strength, product design stress Sd and
  hydrotest stress St for the lower two courses and the upper courses, and Young's modulus
  (29,400,000 psi / 202,706 MPa) for 34 plate specifications plus Unknown (30,000 / 55,000 psi).
  Riveted tanks use 21,000 psi. Materials not listed use 0.80Y / 0.429T and 0.88Y / 0.472T (product),
  0.88Y / 0.472T and 0.90Y / 0.519T (hydrotest).
- **Construction code, edition and supplement** lists (API 12A–12F, 620, 650 and Annexes A / J / S,
  653, AWWA D100, NFPA 22, UL 142; API 650 1st–13th editions with their supplements, revisions and
  addenda; API 12C 1st–15th editions). Added beyond the workbook: API 650 13th edition Errata 1 (2021)
  and the 14th edition (date to confirm).
- **API 653 Tables 4.2 / 4.3 joint efficiencies**, by code and edition (welded) or rivet rows (riveted).
- **API 653 Fig. B.11 / B.12 edge-settlement curves** tabulated for D = 20–160 ft and R = 0–6 ft.
- **B.3.2.2 K values** (open top / fixed roof by diameter).
- **API 653 Table 4.5 and API 650 Table 5.1b** annular plate thickness.
- **Nozzle neck walls**: Sch XS / STD by NPS (less 12.5 % mill tolerance for the minimum) and the neck
  wall for NPS 26 and larger by shell thickness; the schedule follows the construction code.

**Tank setup → Construction & design**: construction code, edition, supplement, product specific
gravity G and maximum fill height (blank = shell height).

**Shell UT → Shell evaluation (API 653 4.3.3)**: pick the shell material and joint for all courses (or
per course), override Y / T if needed. For each course the app shows E, Sd, St, the liquid height above
the course, **t-min = 2.6 (H − 1) D G / (S E)** (not less than 0.100 in), the t-min used (a value typed in
the course table overrides the calculation), the minimum reading and status, the **maximum product fill
height** the minimum reading supports, and the **hydrostatic test height** Ht = St E t / (2.6 D) + 1. The
report includes the table.

**Nozzles**: when nominal wall or t-min is left blank, the nozzle neck table value for the size and
construction code is used (shown grey, marked T in the report).

**API 653 page**: the annular plate minimum from Table 4.5 (SG < 1, Sb = 2.34 D (H − 1) / t) or
Table 5.1b (SG ≥ 1, Sb = 2.6 D (H − 1) G / t) with course 1 nominal thickness, and a button to use it.

### Settlement (API 653 Annex B)

The **Settlement** page evaluates a settlement survey to API 653 Annex B.

**Shell settlement (planar tilt and out-of-plane).** The number of stations defaults to N = D/10
(D in ft), rounded up to an even number, at least 8 and no more than 32 ft apart; override it and
the angle of station 1 if needed. Enter readings in inches, decimal feet or mm (or m), as
elevations or as rod readings (larger = lower); press Enter to move to the next station. The app:

- fits the optimum cosine curve a + b·cos θ + c·sin θ by least squares (uniform settlement plus
  planar tilt) and reports R² (must be ≥ 0.90 for the out-of-plane check, B.2.2.4);
- reports the planar tilt across the diameter, the high and low sides, the slope, and the
  out-of-plumbness at the top of the shell (tilt × H). Annex B gives no numeric tilt limit, so this
  is compared with API 653 §10.5.2.1 (1/100 of shell height, 5 in max), with API 650's 1/200 shown
  for reference;
- computes U = measured − cosine curve and S = U − ½(U of the stations either side) at each
  station and checks |S| ≤ Smax = 11·L²·Y / (2·E·H) (B.3.2.1), L = πD/N, Y and E from the shell
  course 1 material (Table 4.1; unknown 30,000 psi and 29,400,000 psi) unless entered, H = shell
  height (from the shell courses unless entered);
- runs the **B.3.2.2 arc method** between successive high points: settlement below the line joining
  the arc ends against min(K · Sarc · (D / H) · (Y / E), 4 in), K from the B.3.2.2 table for the
  diameter and roof type. When R² < 0.90 this replaces the B.3.2.1 out-of-plane check;
- draws a plan (stations, elevation relative to the mean plane, tilt arrow to the low side, edge
  settlement areas and depressions) and a chart of the measured points against the cosine curve
  with the S bars and ±Smax.

If R² is below 0.90 the result is *Engineering evaluation required* (more readings, a rigorous fit,
or the B.3.2.2 method).

**Edge settlement (B.2.3 / B.3.4).** For each settled area record its angle, radial width R,
settlement B (measured per Fig. B.6 / B.7), the bottom weld in the area, and the allowables read
from Fig. B.11 (**Bew**, lap weld within ±20° of parallel to the shell) and Fig. B.12 (**Be**, no
weld, butt welds, or lap weld within ±20° of perpendicular) at R for the tank diameter. Lap welds
at another angle use B = Be − (Be − Bew)·sin α. Any area may be screened against Bew alone. The
status is *Acceptable*, *NDE required* (75 % of allowable or more: VT and MT/PT of the shell-to-bottom
and bottom welds, B.3.4.1) or *Exceeds*. The app does not reproduce the curves of Fig. B.11 / B.12 —
the inspector reads them from their copy of API 653.

**Edge settlement survey (radial readings at every station).** At each settlement station, record
bottom readings radially inward from the shell. The default spacing is a reading at the shell, every
6 in to 2 ft, then every foot to 10 ft (metric: 150 mm to 600 mm, then every 300 mm to 3 m); change
the spacing bands as needed. Readings use the same units and rod/elevation setting as the shell
survey, and Enter moves down the station's readings and then to the next station. For each station
the app fits a straight line through the outer readings (the unsettled bottom, so a cone-up /
cone-down slope is allowed for, Fig. B.7), walks in toward the shell to find the **breakover** (the
last reading within the breakover tolerance, default 1/8 in / 3 mm, of that line), and takes
**R** = shell to breakover and **B** = the largest drop of the bottom below the projected line inside R
(Fig. B.6). The inspector can pick a different breakover. Bew and Be come from the built-in
Fig. B.11 / B.12 table for the tank diameter (or the inspector's own curve), interpolated at each
station's R; values typed for a station override them. α for angled lap welds is the weld's angle to
the tank radius: ≤ 20° uses Be, ≥ 70° uses Bew, between uses Be − (Be − Bew)·sin α. Each station shows R, B, the allowable for the bottom weld
in the area, B / allowable and the status, and a profile chart; the plan marks the settled zones.
The report has the station results, a profile for every station and the readings table.

**Other edge settlement areas.** Areas found between stations can still be entered individually
with their own R, B, weld and Bew / Be.

**Bottom depressions / bulges (B.3.3).** Angle, distance from centre, inscribed radius R and depth B,
checked against BB = 0.37·R (BB in inches, R in feet).

The report has a Settlement section (plan, chart, results, station table, edge and depression
tables); *Export → Settlement survey (CSV / Excel)*. Check the limits against the edition of API 653
in force.

## UT loader sheet (Excel)

The inspector builds the tank in the app, then hands the UT technician an Excel workbook to fill in;
the completed workbook is uploaded and the report updates.

1. **Download** — *Export → UT loader sheet (Excel)* (or **UT loader ↓** on the Shell UT, Roof and
   Indications pages). The workbook has a sheet for each UT area set up in the job:
   - **Shell** — every reading elevation × every UT station, with the course and its nominal / t-min.
   - **Nozzles** — 12, 3, 6 and 9 o'clock neck readings, with nominal / t-min.
   - **Fixed roof** — each UT point (angle, distance from centre).
   - **Floating roof** — the 5 readings (corners and centre) for each deck plate.
   - **Floor prove-up** — UT minimum remaining and UT method for each MFL indication (plate, X / Y).
   - **Info** — tank, report no., job ID, instructions, and cells for the UT technician's name,
     instrument, serial no., probe and date of readings.
   Readings already in the job are filled in. Input cells are yellow; headers and labels are frozen;
   readings below t-min turn red; data validation rejects text and impossible values. Hidden ID
   columns tie each cell back to its station, plate, nozzle or indication — leave them alone.
2. **The UT technician** fills in the yellow cells (Excel, LibreOffice or Google Sheets saved as
   .xlsx) and returns the file.
3. **Upload** — *Export → Upload completed UT loader sheet…* (or **UT loader ↑**). The app shows a
   **preview** before changing anything (v3.19): every reading in the sheet against the job, by area, as
   new, changed, conflict (it differs from a verified reading), same, not in this job or unreadable.
   New and changed readings start ticked; each conflict needs a choice (keep, use the sheet, or skip)
   before **Apply** is enabled. **Blank cells never erase readings already in the job.** Apply keeps a
   revision of the job as it was, logs the changes in the audit trail and records every decision; the
   same sheet loaded again is recognised and shows only what still differs. See *stage 10* above.

Units follow the job (inches or millimetres); the sheet records which it used.

## Location convention — datum corners

Every indication and feature is located by **plate + X/Y measured from the plate's datum corner**.
The datum corner of each plate is marked on the map with a small green triangle tucked into that corner.

- **Bottom plates:** X is horizontal and Y vertical *on the drawing*. Every plate uses the job's
  default corner (Setup → *Default datum corner*) unless you mark a different one.
- **Mark the corner used:** on the Floor map press **D** (*Set datum*) and click inside the plate,
  in the corner the crew measured from. You can also pick the corner in the plate panel or in the
  Datum column on the Plates page. X/Y values stay as entered; they are read from the new corner.
- **X and Y are never negative.** They are measured from the plate's outer edges on the datum
  side, so every point on the plate is zero or more. On cut edge plates where the datum corner falls
  outside the shell, the marker is drawn where the seam meets the shell, but X/Y are still measured
  from the plate's edges. Typed negative values are refused.
- **Annular plates:** the datum is the start seam (X runs clockwise along the shell) or the end seam
  (X runs counter-clockwise); Y is the distance in from the shell.
- Angles are clockwise from 0° at the top of the drawing; the 0° label (N, manway, etc.) is set in Setup.
- The report marks the datum corners on the floor map, lists plates measured from a non-default
  corner, and the plate register shows each plate's datum corner.

## API 653 calculation

```
MRT = min(RTbc, RTip) − Or × (StPr + UPr)
```

- **RTip / RTbc** — minimum remaining thickness of unrepaired product-side / soil-side locations
  (nominal or the plate's general UT if there are none).
- **StPr / UPr** — maximum linear corrosion rate of unrepaired product-side / soil-side locations:
  wall loss ÷ rate basis (years). The *coated* / *effective CP* options and overrides apply as set out
  in *Calculation corrections (v3.6.0)* above (for example, recorded product-side pitting keeps StPr on
  a coated floor unless the engineer confirms the coating basis).
- Remaining thickness per indication comes from UT; otherwise nominal − VT pit depth (product side);
  otherwise the MFL % estimate (flagged in the report).
- "Both sides" splits loss into VT pit depth (product side) and the remainder (soil side).
- Repair **Auto**: the worst location below the limit is marked for repair, the rates are re-derived
  from what's left, and this repeats until everything passes; unneeded repairs are then pruned.
  **Yes** forces a repair, **No** keeps the location in service and flags it if below MRT.
- Limits are separate for bottom plates, annular plates and the critical zone (within 3 in / 75 mm
  of the shell; since v3.6.0 the default limit is the smaller of 0.118 in (3 mm) and ½ course 1
  t-min, not less than 0.10 in (2.5 mm), and an entered limit needs a reason). The limit presets for bottom plates are 0.10 in (no leak detection/containment) and
  0.05 in (leak detection & containment, or a reinforced lining > 0.05 in).

These defaults follow API 653 §4.4.7 as commonly applied. **Check them against the edition you
work to, the owner's requirements and Table 4.5 for annular plates before issuing a report** —
every limit is editable.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/app.css` | Screen, dark mode and print styles |
| `js/app.js` | Entry point: loads the screens, wires the core, binds job fields, window events, start-up |
| `js/app/state.js` | App state `S`, version, shared option lists and small helpers |
| `js/app/nav.js` | Screen registry, navigation, side menu drawing, the `redraw` registry |
| `js/app/actions.js` | Button (`data-act`) and input change registries and their document listeners |
| `js/app/fields.js` | Form fields, reading inputs, keeping focus across redraws |
| `js/app/persist.js` | Saving the open job: recalculation, save queue, crash journal, change count, `commit` |
| `js/app/header.js` | Header, job file badge, revision text |
| `js/app/folder.js` | Linked jobs folder: link, scan, write a stage back |
| `js/app/stage.js` | Every stage change: revisions, issuing the report at Complete, the reason to reopen |
| `js/app/lock.js` | The Complete lock on the job's screens and in the action dispatch |
| `js/app/auditlog.js` | Recording the audit trail: each write of the open job, other sources, merging a file's entries |
| `js/app/revisions.js` | Keeping revisions: on file save, stage change, import, restore; the daily checkpoint; content checksum; the Complete lock test |
| `js/app/images.js`, `js/app/menu.js` | Photo / logo helpers; side menu section button |
| `js/views/*.js` | One module per screen area: dashboard, registry, jobs, setup, floormap, floorlists, api, shell, nozzles, roof, settle, sections, summary, report, codetables, files, history, backup, revisions, audit, loaderpreview, storage |
| `js/backup.js` | Backup file: written in pieces with a checksum, verified, compared with the device |
| `js/validate.js` | Job file checks before an import: problems and things to check |
| `js/prune.js` | Which revisions are kept (15 checkpoints, 5 others, never file-save or issued) and which binned photos go |
| `js/audit.js` | Audit entries: changed fields, the checksum chain and its check, rows and filters for the screen |
| `js/issuedfile.js` | The issued report inside a job file: photos as references, checked on opening |
| `js/revdiff.js` | Field-by-field comparison of two versions of a job |
| `js/duplicates.js` | Is an imported job already here, a different version, or possibly the same inspection twice |
| `js/ui.js` | Element lookup, toasts and in-app dialogs |
| `js/cards.js` | Job summary cards for the Jobs list, Dashboard and registry |
| `js/util.js` | HTML escaping (the one place it is defined) |
| `js/geometry.js` | Plate layout generator, plate ↔ floor coordinates |
| `js/calc.js` | Indication analysis and API 653 MRT |
| `js/map.js` | SVG floor map and pan/zoom |
| `js/report.js` | Printable report: the content of each chapter |
| `js/report/calcapp.js` | Calculation appendices (R5): the five-part layout and one builder per calculation |
| `js/report/floor.js` | Floor chapter parts (R3): MFL inspection, prove-up, corrosion summaries, repair status |
| `js/report/front.js` | Report front chapters (R2): executive summary, tank identification and design, scope and limitations, personnel / equipment / calibration |
| `js/personnel.js` | Inspection personnel (schema 5) and the name helpers |
| `js/sources.js` | Sources of design data (schema 5) |
| `js/views/r2fields.js` | Entry cards for the schema 5 fields and their list handlers |
| `js/small.js` | Small tank report template: checklist items, defaults, suggestion (schema 6) |
| `js/views/small.js` | Small tank checklist screen and the Report card on Tank setup |
| `js/report/small.js` | The small tank report: chapters in the template order (S3) |
| `js/floorut.js` | Floor UT survey (schema 7): areas, critical zone and lower shell scans, five readings per plate; the readings as locations for the API 653 evaluation |
| `js/views/floorut.js` | Floor → UT readings screen |
| `js/guide.js`, `js/views/guide.js` | The user guide's text (kept current every release) and its screen |
| `js/smallcalc.js` | Small tank calculations: thickness and rates, intervals, planar tilt, edge settlement (S2) |
| `js/report/frame.js` | Report frame: chapter order and switches, numbering, cover, document control, contents, value key, page set-up, running header and footer |
| `js/export.js` | CSV, SVG/PNG export |
| `js/db.js` | IndexedDB storage (jobs, photos and the photo bin, light job cards, registry, settings, revisions, audit, imports); job + photo writes are one transaction |
| `js/loader.js`, `js/xlsx.js` | UT loader sheet: building the workbook, reading it back into a list of readings with a status |
| `js/saver.js`, `js/journal.js`, `js/migrations.js`, `js/integrity.js` | Save queue, crash recovery copy, numbered migrations, the database check |
| `js/model.js`, `js/demo.js` | Job model, demo data |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA install and offline support |
| `tests/` | Golden and browser tests (not used by the app) |
