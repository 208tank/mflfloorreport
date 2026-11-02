// Minimal .xlsx writer and reader — no libraries, works offline.
// Writer: inline strings, a fixed style set, frozen panes, hidden rows/columns, data validation and
// conditional formatting. Reader: shared or inline strings and numbers from every sheet.

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------------------------ zip --- */

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch { return null; }
}
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Use a current version of Chrome or Edge.');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

async function zip(files, type) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = f.data, crc = crc32(raw);
    let data = raw, method = 0;
    const z = await deflateRaw(raw); if (z && z.length < raw.length) { data = z; method = 8; }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cd = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cd, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    files.set(name.replace(/^\//, ''), { method, raw: u8.subarray(start, start + csize) });
    p += 46 + nl + xl + cl;
  }
  return {
    async text(name) {
      const f = files.get(name.replace(/^\//, '')); if (!f) return null;
      return dec.decode(f.method === 8 ? await inflateRaw(f.raw) : f.raw);
    }
  };
}

/* --------------------------------------------------------------------------- writer --- */

const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const ref = (r, c) => colName(c) + (r + 1);

// style ids (cellXfs order below)
export const ST = { def: 0, title: 1, hdr: 2, in: 3, lbl: 4, key: 5, note: 6, ro: 7, num: 8, inTxt: 9, lblB: 10, sub: 11 };

function stylesXml(tFmt) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="${x(tFmt)}"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="8"/><color rgb="FF9AA3AD"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B6470"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0F766E"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE2E8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8BFC8"/></left><right style="thin"><color rgb="FFB8BFC8"/></right><top style="thin"><color rgb="FFB8BFC8"/></top><bottom style="thin"><color rgb="FFB8BFC8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><font><b/><color rgb="FFB91C1C"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E2"/><bgColor rgb="FFFDE2E2"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;
}

function cellXml(r, c, cell) {
  if (cell === null || cell === undefined) return '';
  const o = typeof cell === 'object' && !Array.isArray(cell) ? cell : { v: cell };
  const s = o.s ?? 0, at = `r="${ref(r, c)}"${s ? ` s="${s}"` : ''}`;
  if (o.v === null || o.v === undefined || o.v === '') return s ? `<c ${at}/>` : '';
  if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c ${at}><v>${o.v}</v></c>`;
  return `<c ${at} t="inlineStr"><is><t xml:space="preserve">${x(o.v)}</t></is></c>`;
}

function sheetXml(sh) {
  const o = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  o.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  const fr = sh.freeze;
  if (fr && (fr.r || fr.c)) {
    const pane = fr.r && fr.c ? 'bottomRight' : fr.r ? 'bottomLeft' : 'topRight';
    o.push(`<sheetViews><sheetView workbookViewId="0"><pane${fr.c ? ` xSplit="${fr.c}"` : ''}${fr.r ? ` ySplit="${fr.r}"` : ''} topLeftCell="${ref(fr.r || 0, fr.c || 0)}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${ref(fr.r || 0, fr.c || 0)}" sqref="${ref(fr.r || 0, fr.c || 0)}"/></sheetView></sheetViews>`);
  } else o.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
  o.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sh.cols?.length) o.push('<cols>' + sh.cols.map((c, i) => (c ? `<col min="${i + 1}" max="${i + 1}" width="${c.w || 10}" customWidth="1"${c.hidden ? ' hidden="1"' : ''}/>` : '')).join('') + '</cols>');
  o.push('<sheetData>');
  sh.rows.forEach((row, r) => {
    if (!row) return;
    const cells = row.cells || row;
    const inner = cells.map((cell, c) => cellXml(r, c, cell)).join('');
    const attrs = `${row.hidden ? ' hidden="1"' : ''}${row.ht ? ` ht="${row.ht}" customHeight="1"` : ''}`;
    if (inner || attrs) o.push(`<row r="${r + 1}"${attrs}>${inner}</row>`);
  });
  o.push('</sheetData>');
  if (sh.protect) o.push('<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" sort="0" autoFilter="0"/>');
  if (sh.merges?.length) o.push(`<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  (sh.cf || []).forEach((cf, i) => o.push(`<conditionalFormatting sqref="${cf.sqref}"><cfRule type="expression" dxfId="0" priority="${i + 1}"><formula>${x(cf.formula)}</formula></cfRule></conditionalFormatting>`));
  if (sh.dv?.length) {
    o.push(`<dataValidations count="${sh.dv.length}">`);
    for (const d of sh.dv) {
      if (d.list) o.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" sqref="${d.sqref}"><formula1>"${x(d.list.join(','))}"</formula1></dataValidation>`);
      else o.push(`<dataValidation type="decimal" operator="between" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Check the reading" error="${x(d.error || 'Enter a thickness reading as a number.')}" promptTitle="${x(d.promptTitle || '')}" prompt="${x(d.prompt || '')}" sqref="${d.sqref}"><formula1>${d.min}</formula1><formula2>${d.max}</formula2></dataValidation>`);
    }
    o.push('</dataValidations>');
  }
  o.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  o.push(`<pageSetup orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`);
  if (sh.printTitles) o.push('');
  o.push('</worksheet>');
  return o.join('');
}

const safeName = (n) => String(n).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31);

/** sheets: [{ name, rows: [[cell]] | [{cells, hidden, ht}], cols: [{w, hidden}], freeze: {r, c}, cf: [{sqref, formula}], dv: [...], merges }] */
export async function writeXlsx(sheets, { tFmt = '0.000', title = '' } = {}) {
  const n = sheets.length;
  const files = [];
  const add = (name, s) => files.push({ name, data: enc.encode(s) });
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>Tank Floor Inspector</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${x(safeName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', stylesXml(tFmt));
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* --------------------------------------------------------------------------- reader --- */

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
const els = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

/** Returns [{ name, rows: Map<rowIndex, Map<colIndex, string|number|boolean>> }] (0-based indexes). */
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const wbXml = await z.text('xl/workbook.xml');
  if (!wbXml) throw new Error('This is not an Excel workbook.');
  const relsXml = await z.text('xl/_rels/workbook.xml.rels');
  const rels = new Map(els(parse(relsXml || '<r/>'), 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sstXml = await z.text('xl/sharedStrings.xml');
  const sst = sstXml ? els(parse(sstXml), 'si').map((si) => els(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')) : [];
  const out = [];
  for (const sh of els(parse(wbXml), 'sheet')) {
    const id = sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id');
    let target = rels.get(id) || ''; if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await z.text(target); if (!xml) continue;
    const rows = new Map();
    let rAuto = 0;
    for (const row of els(parse(xml), 'row')) {
      const rn = row.getAttribute('r') ? +row.getAttribute('r') - 1 : rAuto; rAuto = rn + 1;
      let cAuto = 0;
      for (const c of els(row, 'c')) {
        const r = c.getAttribute('r'); const m = r && r.match(/^([A-Z]+)(\d+)$/);
        const ci = m ? colIndex(m[1]) : cAuto; cAuto = ci + 1;
        const t = c.getAttribute('t'), vEl = els(c, 'v')[0], v = vEl ? vEl.textContent : null;
        let val = null;
        if (t === 's') val = v !== null ? sst[+v] ?? '' : null;
        else if (t === 'inlineStr') val = els(c, 't').map((n) => n.textContent).join('');
        else if (t === 'str') val = v;
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = null;
        else if (v !== null && v !== '') val = Number(v);
        if (val === null || val === '') continue;
        if (!rows.has(rn)) rows.set(rn, new Map());
        rows.get(rn).set(ci, val);
      }
    }
    out.push({ name: sh.getAttribute('name'), rows });
  }
  return out;
}
