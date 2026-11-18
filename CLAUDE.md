# Working on Tank Floor Inspector

- Plain HTML / CSS / JS modules, no build step. Run `node --test tests/*.test.mjs` and the browser checks
  (`node tests/browser/run.mjs [filter]`) before committing. Golden files change only for a reviewed reason.
- Every release: bump `APP_VERSION` (js/app/state.js) and `CACHE` (sw.js), add new modules to `ASSETS` in sw.js, and
  add a section at the top of README.md.
- **Keep the user guide current.** Any change a user can see or do updates `js/guide.js` (the in-app *User guide*)
  and sets `GUIDE_VERSION` to the new `APP_VERSION`; `tests/guide.test.mjs` fails otherwise, and when a menu page or
  map layer is missing from the guide. Then refresh the shared copy of the guide (the "Tank Floor Inspector — Field
  Guide" doc in the user's claude.ai artifacts) and the project's README copy (`claude/tank-floor-inspector-README.md`).
- Commit and push to `main` (GitHub Pages serves it) only when the user says so.
