// Minimal Excel (.xlsx) writer for list exports: one sheet, a bold frozen header row, text / number / date cells
// (dates are real Excel dates with a date format, amounts are numbers with thousands separators). No library: an
// .xlsx file is a zip of a few XML files, written here uncompressed ("stored"), which Excel opens like any other.

export type XlsxCellType = 'text' | 'number' | 'date' | 'datetime';

export interface XlsxColumn {
  header: string;
  type?: XlsxCellType;
  /** Column width in characters (default: from the header and the first rows). */
  width?: number;
}

export interface XlsxSheet {
  /** Sheet tab name (cut to 31 characters; characters Excel does not allow are removed). */
  name: string;
  columns: XlsxColumn[];
  /** One array per row, in column order. Dates as Date (or an ISO string), numbers as number. */
  rows: unknown[][];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Cell styles (index into cellXfs below): 0 default, 1 header, 2 date, 3 date + time, 4 number.
const STYLE_HEADER = 1, STYLE_DATE = 2, STYLE_DATETIME = 3, STYLE_NUMBER = 4;

/** Builds the workbook as a Blob ready to download. */
export function buildXlsx(sheet: XlsxSheet): Blob {
  const files: [string, string][] = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', workbookXml(sheetName(sheet.name))],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(sheet)],
  ];
  const enc = new TextEncoder();
  return new Blob([zipStored(files.map(([name, xml]) => [name, enc.encode(xml)] as [string, Uint8Array]))], { type: XLSX_MIME });
}

/** Saves a Blob as a file (same way the security deposit report downloads its Excel file). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/**
 * A date from an API value as the screens show it: "YYYY-MM-DD" = that calendar day; an ISO date-time without a
 * zone = that local time; with "Z" / an offset = converted to the browser's time. Null when it is not a date.
 */
export function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = day ? new Date(+day[1], +day[2] - 1, +day[3]) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---- sheet ------------------------------------------------------------------------------------------------------

function sheetName(name: string): string {
  const clean = String(name ?? '').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return clean || 'Sheet1';
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  if (cols.length) {
    out.push('<cols>');
    cols.forEach((c, i) => out.push(`<col min="${i + 1}" max="${i + 1}" width="${columnWidth(c, i, sheet.rows)}" customWidth="1"/>`));
    out.push('</cols>');
  }
  out.push('<sheetData>');
  out.push(`<row r="1">${cols.map((c, i) => textCell(ref(i, 1), c.header, STYLE_HEADER)).join('')}</row>`);
  sheet.rows.forEach((row, r) => {
    const rowNo = r + 2;
    const cells = cols.map((c, i) => cell(ref(i, rowNo), row[i], c.type ?? 'text')).join('');
    out.push(`<row r="${rowNo}">${cells}</row>`);
  });
  out.push('</sheetData>');
  out.push('</worksheet>');
  return out.join('');
}

function cell(at: string, value: unknown, type: XlsxCellType): string {
  if (value == null || value === '') return '';
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? `<c r="${at}" s="${STYLE_NUMBER}"><v>${n}</v></c>` : textCell(at, value);
  }
  if (type === 'date' || type === 'datetime') {
    const d = toDate(value);
    if (!d) return textCell(at, value);
    const serial = excelSerial(d, type === 'datetime');
    return `<c r="${at}" s="${type === 'datetime' ? STYLE_DATETIME : STYLE_DATE}"><v>${serial}</v></c>`;
  }
  return textCell(at, value);
}

function textCell(at: string, value: unknown, style = 0): string {
  const s = xmlText(String(value));
  return `<c r="${at}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${s}</t></is></c>`;
}

/** Excel serial date (days since 30 Dec 1899) of the local date (and time) the screen shows. */
function excelSerial(d: Date, withTime: boolean): number {
  const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
    withTime ? d.getHours() : 0, withTime ? d.getMinutes() : 0, withTime ? d.getSeconds() : 0);
  const days = (ms - Date.UTC(1899, 11, 30)) / 86400000;
  return Math.round(days * 86400) / 86400;
}

function ref(col: number, row: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${row}`;
}

function columnWidth(c: XlsxColumn, index: number, rows: unknown[][]): number {
  if (c.width) return c.width;
  if (c.type === 'date') return 13;
  if (c.type === 'datetime') return 18;
  let max = c.header.length;
  for (let r = 0; r < rows.length && r < 200; r++) {
    const v = rows[r][index];
    if (v != null) max = Math.max(max, String(v).length);
  }
  return Math.min(60, Math.max(8, max + 2));
}

/** XML-escapes text and drops characters XML does not allow (control characters other than tab / new line). */
function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- fixed parts --------------------------------------------------------------------------------------------------

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';

const WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

function workbookXml(name: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets>`
    + '</workbook>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy hh:mm"/>'
  + '<numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// ---- zip (stored, no compression) -----------------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(files: [string, Uint8Array][]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    lv.setUint16(8, 0, true);            // method: stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra length
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory header
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attributes
    cv.setUint32(38, 0, true);           // external attributes
    cv.setUint32(42, offset, true);      // offset of the local header
    central.set(nameBytes, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central directory
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}
