// ============================================================
// A real Excel workbook (.xlsx, Office Open XML) written in the browser, without a spreadsheet library: one sheet
// per table, the first rows bold and frozen, numbers as numbers (thousands separators), text as text. The parts are
// packed in an uncompressed ZIP (STORE), which Excel, LibreOffice, Numbers and Google Sheets all open.
// ============================================================

/** One cell: text, a number, true / false, or empty (null / undefined / ''). */
export type XlsxCell = string | number | boolean | null | undefined;

export interface XlsxSheet {
  /** Tab name (at most 31 characters; [ ] : * ? / \ are dropped, duplicates get a number). */
  name: string;
  rows: XlsxCell[][];
  /** Rows at the top shown bold and kept in view while scrolling (default 1; 0 = none). */
  header?: number;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Text safe inside XML (also without the control characters XML does not allow). */
function esc(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Style ids of styles.xml: 0 text, 1 header (bold), 2 whole number (#,##0), 3 decimal (#,##0.0#), 4 bold number. */
function cellXml(ref: string, v: XlsxCell, bold: boolean): string {
  if (v === null || v === undefined || v === '') return bold ? `<c r="${ref}" s="1"/>` : '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    const s = bold ? 4 : Number.isInteger(v) ? 2 : 3;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${bold ? ' s="1"' : ''}><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const header = Math.max(0, sheet.header ?? 1);
  const width = Math.max(1, ...sheet.rows.map(r => r.length));
  // Column widths from the longest value (numbers as they show with separators), between 8 and 60 characters.
  const widths = Array.from({ length: width }, (_, c) => {
    const longest = Math.max(0, ...sheet.rows.map(r => {
      const v = r[c];
      if (v === null || v === undefined) return 0;
      return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }).length : String(v).length;
    }));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const view = header > 0 && sheet.rows.length > header
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const rows = sheet.rows.map((r, i) => {
    const cells = r.map((v, c) => cellXml(`${colName(c)}${i + 1}`, v, i < header)).join('');
    return `<row r="${i + 1}">${cells}</row>`;
  }).join('');
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">`
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0#"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Tab names Excel accepts: no [ ] : * ? / \, at most 31 characters, unique (case-insensitive). */
function sheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name || `Sheet ${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The workbook's parts (path -> XML). */
function workbookParts(sheets: XlsxSheet[]): [string, string][] {
  const list = sheets.length ? sheets : [{ name: 'Sheet 1', rows: [] }];
  const names = sheetNames(list);
  const parts: [string, string][] = [
    ['[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>`
      + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', STYLES]
  ];
  list.forEach((s, i) => parts.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return parts;
}

// ---------- ZIP (STORE: no compression) ----------

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = enc.encode(path);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0x0800, true);      // UTF-8 names
    lv.setUint16(8, 0, true);           // STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}

/** The workbook as an .xlsx file. */
export function buildXlsx(sheets: XlsxSheet[]): Blob {
  const enc = new TextEncoder();
  const bytes = zip(workbookParts(sheets).map(([path, xml]) => [path, enc.encode(xml)] as [string, Uint8Array]));
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Saves a file the browser offers as a download. */
export function downloadFile(fileName: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Builds the workbook and downloads it as `fileName` (.xlsx). */
export function downloadXlsx(fileName: string, sheets: XlsxSheet[]) {
  downloadFile(fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`, buildXlsx(sheets));
}
