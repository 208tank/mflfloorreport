# Tank Floor Inspector

An offline-first Progressive Web App for documenting aboveground storage tank floor inspections:
MFL scanning indications, UT and VT prove-up of product side and soil side corrosion, a plate map
drawing, the API 653 bottom minimum remaining thickness (MRT) calculation, and a printable report.

Plain HTML, CSS and JavaScript modules. No build step, no server, no external libraries — it runs
from GitHub Pages and keeps working with no connection once opened.

## Modular refactoring (v3.12.0 onwards)

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

Screen modules can't import `app.js`, so the few app-level steps they need that haven't moved yet (saving and loading, the
recovery journal, opening and importing job files, and the floor map and setup redraws) are handed over at start-up through `js/app/host.js`.

## Data integrity upgrade — stage 4: database integrity check (v3.11.0)

`js/integrity.js` checks the device database and lists what it finds; it never changes anything itself.

- **When:** a quick check runs in the background a moment after the app starts and only speaks up if it
  finds something. A full check (which also opens every photo and verifies every revision's checksum)
  runs from Settings → This device → **Check data on this device**.
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
- `node tests/tools/screens-diff.mjs <old copy> <new copy>` — renders every screen with the demo tank in
  two copies of the app and reports any difference in the HTML. Used to confirm a refactoring step
  changes nothing on screen.
- `node tests/tools/actions-diff.mjs <old copy> <new copy> <script>` — runs a scripted sequence of edits
  (`tests/tools/scripts/`) on both copies and compares the job data, registry records, screen and focus after every step.
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
  Cancel. A stage change made from a teammate's Dashboard is not a conflict: it is merged into your
  save instead of being overwritten.
- A job file saved by a newer version of the app is refused with a message to reload and update, so
  an older installed copy can't re-save it and lose the newer data. Older jobs opened in a newer
  version are updated, and the app says what changed (e.g. the API 653 patch margin).
- Clearing the browser's site data deletes jobs that haven't been saved to a file. The app asks the
  browser to keep its data permanently and warns when the device's storage is over 80 % full.

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
3. **Upload** — *Export → Upload completed UT loader sheet…* (or **UT loader ↑**). The app checks
   the sheet belongs to this job, then shows a summary before changing anything: new and changed
   readings per area, technician details, rows for items that no longer exist, and any cells it
   could not read (e.g. "n/a"). **Blank cells never erase readings already in the job.** Uploading
   the same sheet again changes nothing. Each upload is logged in the job.

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
  wall loss ÷ rate basis (years). Set to 0 by the *coated* / *effective CP* options, or overridden.
- Remaining thickness per indication comes from UT; otherwise nominal − VT pit depth (product side);
  otherwise the MFL % estimate (flagged in the report).
- "Both sides" splits loss into VT pit depth (product side) and the remainder (soil side).
- Repair **Auto**: the worst location below the limit is marked for repair, the rates are re-derived
  from what's left, and this repeats until everything passes; unneeded repairs are then pruned.
  **Yes** forces a repair, **No** keeps the location in service and flags it if below MRT.
- Limits are separate for bottom plates, annular plates and the critical zone (within 3 in / 75 mm
  of the shell; default limit = ½ original plate thickness or ½ lower shell course t-min, not less
  than 0.1 in). The limit presets for bottom plates are 0.10 in (no leak detection/containment) and
  0.05 in (leak detection & containment, or a reinforced lining > 0.05 in).

These defaults follow API 653 §4.4.7 as commonly applied. **Check them against the edition you
work to, the owner's requirements and Table 4.5 for annular plates before issuing a report** —
every limit is editable.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/app.css` | Screen, dark mode and print styles |
| `js/app.js` | UI, views, events, job files |
| `js/ui.js` | Element lookup, toasts and in-app dialogs |
| `js/cards.js` | Job summary cards for the Jobs list, Dashboard and registry |
| `js/util.js` | HTML escaping (the one place it is defined) |
| `js/geometry.js` | Plate layout generator, plate ↔ floor coordinates |
| `js/calc.js` | Indication analysis and API 653 MRT |
| `js/map.js` | SVG floor map and pan/zoom |
| `js/report.js` | Printable report |
| `js/export.js` | CSV, SVG/PNG export |
| `js/db.js` | IndexedDB storage (jobs, photos, light job cards, registry, settings); job + photo writes are one transaction |
| `js/model.js`, `js/demo.js` | Job model, demo data |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA install and offline support |
| `tests/` | Golden and browser tests (not used by the app) |
