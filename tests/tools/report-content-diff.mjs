// Is everything in the old report still in the new one? For each test job, compares the old report (the golden file
// recorded before a change) with the report the code builds now: every table cell (multiset of cell texts), every
// drawing (<svg>), every photo (<img>) and every note. Usage: node tests/tools/report-content-diff.mjs [fixture…]
// Prints what is missing from the new report; exits 1 if anything is.
import { readFileSync, readdirSync } from 'node:fs';
import { reportHTML } from '../golden.test.mjs';

const GOLD = new URL('../golden/', import.meta.url), FIX = new URL('../fixtures/', import.meta.url);
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ' [svg] ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cells = (html) => { const m = new Map(); for (const x of html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)) { const t = text(x[1]); if (t) m.set(t, (m.get(t) || 0) + 1); } return m; };
const notes = (html) => [...html.matchAll(/<(p|li|h3|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((x) => text(x[2])).filter(Boolean);
const count = (html, re) => (html.match(re) || []).length;
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(GOLD).filter((f) => f.endsWith('.report.html')).map((f) => f.replace('.report.html', ''));
let bad = 0;
for (const name of names) {
  const oldH = readFileSync(new URL(`${name}.report.html`, GOLD), 'utf8');
  const newH = reportHTML(JSON.parse(readFileSync(new URL(`${name}.json`, FIX), 'utf8')));
  const a = cells(oldH), b = cells(newH), miss = [];
  for (const [t, n] of a) if ((b.get(t) || 0) < n) miss.push(`cell ×${n - (b.get(t) || 0)}: ${t.slice(0, 100)}`);
  const nb = new Set(notes(newH)), all = text(newH).toLowerCase(); // a heading may now be part of a numbered table title
  for (const t of notes(oldH)) if (!nb.has(t) && !all.includes(t.toLowerCase())) miss.push(`text: ${t.slice(0, 100)}`);
  for (const [what, re] of [['drawings', /<svg\b/g], ['photos', /<img\b/g]]) if (count(newH, re) < count(oldH, re)) miss.push(`${what}: ${count(oldH, re)} before, ${count(newH, re)} now`);
  console.log(`${name}: ${a.size} distinct cells, ${notes(oldH).length} paragraphs, list items and headings, ${count(oldH, /<svg\b/g)} drawings — ${miss.length ? miss.length + ' missing' : 'all present'}`);
  for (const m of miss.slice(0, 20)) console.log('   ' + m);
  bad += miss.length;
}
process.exit(bad ? 1 : 0);
