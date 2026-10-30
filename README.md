# Tank Floor Inspector

An offline-first Progressive Web App for documenting aboveground storage tank floor inspections:
MFL scanning indications, UT and VT prove-up of product side and soil side corrosion, a plate map
drawing, the API 653 bottom minimum remaining thickness (MRT) calculation, and a printable report.

Plain HTML, CSS and JavaScript modules. No build step, no server, no external libraries — it runs
from GitHub Pages and keeps working with no connection once opened.

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
- Clearing the browser's site data deletes jobs that haven't been saved to a file.

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

## Location convention — datum corners

Every indication and feature is located by **plate + X/Y measured from the plate's datum corner**.
The datum corner of each plate is marked on the map with a small green triangle tucked into that corner.

- **Bottom plates:** X is horizontal and Y vertical *on the drawing*. Every plate uses the job's
  default corner (Setup → *Default datum corner*) unless you mark a different one.
- **Mark the corner used:** on the Floor map press **D** (*Set datum*) and click inside the plate,
  in the corner the crew measured from. You can also pick the corner in the plate panel or in the
  Datum column on the Plates page. X/Y values stay as entered; they are read from the new corner.
- **Cut edge plates:** if the chosen corner falls outside the shell, the datum sits where that
  plate's seam meets the shell.
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
| `js/app.js` | UI, views, events |
| `js/geometry.js` | Plate layout generator, plate ↔ floor coordinates |
| `js/calc.js` | Indication analysis and API 653 MRT |
| `js/map.js` | SVG floor map and pan/zoom |
| `js/report.js` | Printable report |
| `js/export.js` | CSV, SVG/PNG export |
| `js/db.js` | IndexedDB storage |
| `js/model.js`, `js/demo.js` | Job model, demo data |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA install and offline support |
