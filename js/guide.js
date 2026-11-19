// User guide (v3.37.0): the step-by-step guide shown in the app under "User guide". No browser APIs.
//
// KEEP IT UP TO DATE: every release that changes what a user sees or does updates the steps below and sets
// GUIDE_VERSION to the new APP_VERSION. tests/guide.test.mjs fails when GUIDE_VERSION is behind the app, or when
// a page in the side menu is not mentioned in the guide.
//
// Text is written as HTML. [[view|Label]] becomes a button that opens that page when a job is open (plain bold text
// otherwise). Keep sentences short and plain: this guide is shared with field crews.

export const GUIDE_VERSION = '3.38.0';
export const GUIDE_URL = 'https://208tank.github.io/mflfloorreport/';

export const GUIDE = [
  { id: 'overview', title: 'The flow in one glance', html: `
<p>Tank Floor Inspector takes a floor inspection from MFL scan to issued API 653 report in one place: draw the floor once, drop
indications and UT readings on it, and the calculation, drawing and report build themselves. It works on a laptop or tablet, with
or without a connection once it has been opened.</p>
<ol>
<li>Open the app and link the team jobs folder.</li>
<li>Start the job and build the tank and floor layout.</li>
<li>Scan with MFL and drop each indication on the floor map.</li>
<li>Prove up with UT / VT and record the floor UT readings.</li>
<li>Hand the UT loader sheet to the technician and load it back.</li>
<li>Review the API 653 results, repairs and recommendations.</li>
<li>Clean up the drawing with Layers and print the report.</li>
<li>Save the job file, move it through review and mark it Complete.</li>
</ol>
<p class="muted small">Want to look around first? [[jobs|Jobs]] → <b>Load demo tank</b> opens a complete example job.</p>` },

  { id: 'setup-device', title: 'Step 1 — Open the app and set up your device', html: `
<ol>
<li>Open <b>${GUIDE_URL}</b> in <b>Chrome or Edge</b>.</li>
<li>Click the <b>install icon</b> in the address bar (or <i>Install app</i>). It then opens like a desktop program and works offline in the tank.</li>
<li>[[jobs|Jobs]] → <b>This device</b>: type your <b>inspector name</b>. It is recorded on every revision and change you make.</li>
<li>[[jobs|Jobs]] → <b>Company</b>: the company name, logo, report page size and the report header and footer, once per device. The logo prints large on the cover and in every page header (change its position, or switch it off, under <i>Report page header and footer</i>).</li>
<li>[[dash|Dashboard]] → <b>Link jobs folder…</b>: pick the team's shared OneDrive / SharePoint jobs folder. The browser asks again each session: click <b>Reconnect</b>.</li>
</ol>
<p class="tip"><b>Tip:</b> when a new version is published the app shows <b>Reload</b>. Reload every device the team uses: an older copy refuses job files saved by a newer one.</p>` },

  { id: 'start-job', title: 'Step 2 — Start the job and build the floor', html: `
<ol>
<li>[[reg|Tank registry]] → the tank → <b>New inspection</b> (or <i>Add tank</i> the first time). Pick the <b>scope</b> (floor, shell, roofs, nozzles, foundation, settlement) and the floor layout to start from: <i>as found last time</i>, <i>registry layout</i> or <i>new floor</i>.</li>
<li>[[setup|Tank setup]]: client, site, report number, inspection date, units (ft/in or m/mm), diameter, bottom and annular nominal thickness, plate width / length, row direction and the <b>0° reference</b> (N, manway …). Under <i>Report</i>, choose the full API 653 report or the small tank report (small tanks then get the [[small|Small tank checklist]]).</li>
<li>Pick the <b>layout method</b>: <i>Automatic grid</i> for standard floors, <i>Row by row</i> when the plates per row are known, or <i>Plate by plate</i> for a measured floor. The preview updates as you type.</li>
<li><b>Datum corners</b>: every location is plate + X / Y from that plate's datum corner. Set the default corner in Tank setup; on the Floor map press <b>D</b> and click the corner the crew actually measured from on any plate that differs.</li>
<li>[[equip|Equipment]] and personnel: the MFL scanner, reference plate, UT gauge, probe and block with calibration dates, and the people with their certifications.</li>
</ol>
<p class="tip"><b>Tip:</b> spend the time here. A correct plate layout and datum corners mean every indication and UT reading lands in the right spot on the drawing.</p>` },

  { id: 'mfl', title: 'Step 3 — MFL scan: record indications on the floor map', html: `
<ol>
<li>Open [[map|Floor map]].</li>
<li>Press <b>N</b> (or <i>+ Indication</i>) and click the plate where the call is. The app fills in the plate and X / Y; type the measured offsets in the side panel to correct them. <b>Shift-click</b> to drop several in a row.</li>
<li>For each indication enter the <b>MFL signal and % loss estimate</b>, and its length / width if you have them (needed near the shell to decide whether it reaches the critical zone).</li>
<li><b>Click a plate</b> to set its scan coverage (scanned / partial / not scanned), a measured nominal thickness or a label. The [[plates|Plates]] page lists every plate; <i>Mark all scanned</i> is a quick start.</li>
<li>Add floor items with <b>+ Feature</b> (sumps, roof columns, existing patches) and shell openings with <b>+ Nozzle</b> (click at the shell; the angle comes from the click).</li>
</ol>
<p class="tip"><b>Tip:</b> the coloured chips (PEND, PS, SS …) filter the map by prove-up result, handy for finding what is still pending. The [[inds|Indications]] list can be sorted and searched.</p>` },

  { id: 'ut', title: 'Step 4 — Prove up and record the floor UT readings', html: `
<p><b>Prove-up of each MFL indication</b> (click it on the map, or the [[inds|Indications]] list): choose the result (product side, soil side, both, no indication or other) and enter the <b>UT minimum remaining</b>, the <b>VT pit depth</b> and the condition. The calculation uses UT first, then nominal less the VT pit depth, then the MFL estimate (flagged as provisional).</p>
<p>[[flut|Floor UT readings]] holds the general UT survey, in four parts:</p>
<ol>
<li><b>Selected areas</b>: <i>+ Area</i>, or <i>+ UT area</i> on the Floor map and click the centre of the area. Enter the plate and <b>X / Y to the centre of the area</b> from the plate datum, the <b>length</b> along X and <b>width</b> along Y, the <b>minimum</b> and <b>average</b> thickness, the <b>condition</b> (general thinning, general pitting, widely scattered pitting, isolated pitting, localized corrosion, lamination, no significant loss, or <i>Custom</i> with your own words) and the <b>side of loss</b> if you know it.</li>
<li><b>Critical zone scans</b>: tick <i>Critical zone scans</i>, set the <b>spacing</b> along the shell (for example 10 ft) and the <b>first scan angle</b>. The app lays out CZ-1, CZ-2 … clockwise, each a 6 × 6 in square against the shell. Enter the floor minimum and average for each.</li>
<li><b>Lower shell scans</b>: tick <i>Lower shell scans at the same locations and size</i>. Columns appear for the shell minimum and average just above the shell-to-bottom weld, checked against the course 1 t-min.</li>
<li><b>Five readings per plate</b>: tick it and enter top-left, top-right, centre, bottom-left and bottom-right for each plate, as drawn on the map (as on a floating roof deck).</li>
</ol>
<p><b>How the readings count:</b> each one is a remaining thickness. If the side of loss is not known it sets the general thickness (RT<sub>UT</sub>); if it is product or soil side it also sets that corrosion rate. Every reading is checked against its area's minimum at the next inspection; anything below shows red as <i>Below MRT</i>.</p>
<p class="tip"><b>Tip:</b> UT readings are never repaired automatically. If an area or scan needs a patch, add an indication there with <i>Repair = Yes</i> so it gets a patch plate and a repair line in the report.</p>` },

  { id: 'loader', title: 'Step 5 — Hand the UT loader sheet to the technician', html: `
<p>The UT technician doesn't need the app: they fill in an Excel workbook built from the job.</p>
<ol>
<li>Set up everything that needs readings first (indications, UT areas, CZ scans, plate readings, shell, nozzles, roofs).</li>
<li>Click <b>UT loader ↓</b> (on the UT readings, Indications, Shell UT or roof pages). The workbook has one sheet per area, including <i>Floor UT areas</i>, <i>Floor CZ scans</i> and <i>Floor plates</i>.</li>
<li>The technician fills in the <b>yellow cells</b> only, in the job's units, and returns the file. Readings below t-min turn red as they type.</li>
<li>Click <b>UT loader ↑</b> and pick the returned file. A <b>preview</b> lists every reading as New, Changed, Same or Conflict. Nothing changes until you press <b>Apply</b>.</li>
</ol>
<ul class="tips">
<li>Blank cells never erase a reading already in the job.</li>
<li>A <b>Conflict</b> means the sheet differs from a verified reading (the job is in peer review, or the value was saved to a job file). Choose keep or use the sheet for each one.</li>
<li>Don't let anyone rename sheets, insert rows or unhide the ID columns: that is how readings find their way back.</li>
</ul>` },

  { id: 'analysis', title: 'Step 6 — Review the API 653 results, repairs and recommendations', html: `
<ol>
<li>Floor → <b>Analysis</b> (API 653): check the tank age (rate basis), O<sub>r</sub> (years to the next internal), the minimum thickness limits and the coating / CP options.</li>
<li>Read the results: RT, MRT and the maximum O<sub>r</sub> for bottom, annular and critical zone, and the warnings under them. The <i>Floor UT readings</i> line lists any UT reading below the minimum.</li>
<li><b>Repairs</b>: indications on <i>Auto</i> are marked for repair worst-first until the rest pass, and get a 12 × 12 in patch (tombstone patches in the critical zone). Set <i>Repair = Yes / No</i> on an indication to override.</li>
<li>Each part of the tank has <b>Observations</b> (with <i>Add typical items</i>), <b>Photos</b> (annotate with arrows, circles and text) and <b>Recommendations</b>: add the <i>Suggested from the analysis</i> items with one click, or write your own. Tick <i>Deficiency</i> for anything the client must track; they collect on [[defs|Deficiencies]].</li>
<li>[[summary|Executive summary]]: use the <i>Draft</i> buttons for a first version of the scope and findings, then edit.</li>
</ol>
<p class="tip"><b>Tip:</b> a result marked <i>Provisional</i> rests on MFL estimates: prove those indications up before the report goes out.</p>` },

  { id: 'other', title: 'The rest of the tank', html: `
<p>Each part of the tank has the same pages: NDE (methods and readings), Observations, Photos, Analysis and Recommendations.</p>
<ul>
<li><b>Shell</b> → [[shell|Shell UT]]: courses, UT stations and reading elevations; Tab moves across, Enter moves up a station. The shell roll-out and the API 653 §4.3.3 evaluation follow.</li>
<li><b>Fixed roof</b> → [[roofF|Fixed roof UT]]: points by angle and distance from the centre, or click <i>+ Point on plan</i>.</li>
<li><b>Floating roof</b> → [[roofL|Deck & pontoons]] (five readings per deck plate, pontoon condition) and [[seal|Rim seal]] (gap survey against US EPA / Canadian limits).</li>
<li><b>Nozzles</b> → [[nozzles|Nozzle UT]]: neck readings at 12, 3, 6 and 9 o'clock.</li>
<li><b>Foundation</b>: observations, photos and recommendations.</li>
<li><b>Settlement</b> → [[settle|Settlement survey]]: shell stations, edge settlement and depressions to API 653 Annex B.</li>
<li>[[ref|Code tables]]: the material, joint efficiency and settlement tables the calculations use (read only).</li>
</ul>` },

  { id: 'report', title: 'Step 7 — Clean up the drawing and print the report', html: `
<p><b>On screen:</b> [[map|Floor map]] → <b>Layers</b>. Switch off anything you don't need to see: indications, indication numbers, plate labels, datum marks, shell nozzles, floor features, shell seams, the critical zone line, repair patches, UT readings, scan hatching. <i>Plates and indications only</i> clears everything else in one click; <i>Show all</i> brings it back. The SVG / PNG map export matches what you see.</p>
<p><b>In the report:</b> [[report|Report]] → <b>Report sections and layout</b>:</p>
<ul>
<li><b>Floor plan layers</b>: the same switches for the printed floor drawing (all on by default).</li>
<li><b>Drawings</b>: landscape or portrait, on report paper or 11 × 17.</li>
<li>Turn chapters and appendices on or off and change their order.</li>
</ul>
<p>Then <b>Print / Save PDF</b>. In the browser's print dialog pick <i>Save as PDF</i>, margins <i>Default</i>, and turn <b>off</b> the browser's <i>Headers and footers</i>: the report prints its own.</p>
<p>Drawing sheets (floor plan, shell roll-out, roof plans) print without the page header and footer: their title block carries the company, logo, tank, report number, revision and status.</p>
<p class="tip"><b>Tip:</b> for a busy tank, a clean floor drawing usually means nozzles, floor features and shell seams off, with plate labels and indications on.</p>` },

  { id: 'complete', title: 'Step 8 — Save, share and complete the job', html: `
<ol>
<li>The app saves to this device automatically (<i>Saved locally</i> in the header). To share or move a job, <b>Save file…</b> (<b>Ctrl+S</b>) into the shared OneDrive jobs folder. Each save is a new revision (Rev 1, Rev 2 …).</li>
<li>On another computer, [[jobs|Jobs]] → <b>Open job file…</b> and pick the file from the synced folder.</li>
<li>Move the job through <b>Upcoming → Inspection ongoing → Reporting → Peer review → Complete</b> by dragging its card on the [[dash|Dashboard]] (or in Tank setup). The team sees the stage on their next rescan.</li>
<li>Marking it <b>Complete</b> issues the report: it is frozen exactly as printed and the job becomes read-only. <b>Reopen</b> asks for a reason; the issued report stays in [[revs|Revisions]].</li>
</ol>
<ul class="tips">
<li>Only one person edits a job at a time: open the latest file, work, save, then hand over. If someone else saved since you opened it, the app asks before overwriting and keeps both versions.</li>
<li>[[jobs|Jobs]] → <b>Back up this device</b> now and then, to somewhere other than the laptop. The app reminds you when a backup is overdue.</li>
<li>[[revs|Revisions]] compares any two versions or restores one; [[audit|Audit trail]] shows who changed what and when.</li>
</ul>` },

  { id: 'tips', title: 'Tips, shortcuts and common mistakes', html: `
<table class="grid"><thead><tr><th>Key (Floor map)</th><th>Does</th></tr></thead><tbody>
<tr><td>N</td><td>Add an indication (click a plate)</td></tr>
<tr><td>D</td><td>Set the datum corner (click inside the plate, in that corner)</td></tr>
<tr><td>F</td><td>Fit the map to the window</td></tr>
<tr><td>Esc</td><td>Stop adding, back to Select</td></tr>
<tr><td>Shift + click</td><td>Keep adding indications, nozzles or UT areas</td></tr>
<tr><td>Ctrl+S / Ctrl+Shift+S</td><td>Save the job file / save as a new file</td></tr>
</tbody></table>
<p><b>Good habits</b></p>
<ul class="tips">
<li><b>Measure from the datum the crew used.</b> If X / Y were taken from a different corner, press D on that plate rather than recalculating the numbers.</li>
<li><b>Enter indication length and width near the shell.</b> Without them the app can't tell whether the corrosion reaches the critical zone, and warns you.</li>
<li><b>Pick a CZ scan spacing that divides the circumference</b> when you can; otherwise the last gap back to CZ-1 is shorter (the page says by how much).</li>
<li><b>Changing the CZ spacing or start angle</b> keeps readings that still sit on a scan; the others are flagged, not lost. Change it back to see them.</li>
<li><b>Use the side of loss on UT areas</b> only when you know it. A known side changes the corrosion rate; <i>Not known</i> only sets the remaining thickness.</li>
<li><b>Hide clutter before exporting</b> the map: the SVG / PNG export follows the Layers menu.</li>
</ul>
<p><b>Common mistakes</b></p>
<ul class="tips">
<li>Using an old installed copy: reload when the app says a new version is available.</li>
<li>Two people editing the same job at once: hand over through the job file.</li>
<li>Printing with the browser's headers and footers on: the report doubles them up.</li>
<li>Expecting a UT reading below the minimum to get a patch automatically: add an indication with a repair there.</li>
</ul>` }
];

/** Every word of the guide as plain text (for the search box and the tests). */
export const guideText = () => GUIDE.map((s) => s.title + ' ' + s.html.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/<[^>]+>/g, ' ')).join(' ');
