// ============================================================
// A page as it is on screen, charts included, as an A4 PDF (html2canvas + jsPDF, loaded only when used): a header
// (title, lines under it, the time it was made), then the page cut into A4 pages between its cards where it can
// (never through a card that fits on a page). Elements matching `hide` are blanked out (the space they take stays,
// so nothing moves); `.no-print` is always hidden.
// ============================================================

export interface PagePdfOptions {
  fileName: string;
  /** Bold first line ("CEO dashboard"). */
  title: string;
  /** Lines under the title (period, location, prepared by...). */
  lines?: string[];
  /** CSS selector of elements not to print (buttons, toggles); `.no-print` is added. */
  hide?: string;
  /** Blocks a page should not cut through (default: cards, panels and table rows). */
  blocks?: string;
  orientation?: 'portrait' | 'landscape';
}

const DEFAULT_BLOCKS = '.kpi-card, .dash-panel, .team-card, .section-title, .section-note, .refresh-error, tr, li';
/** Safari's canvas limit is about 16.7 million pixels: stay under it. */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 32_000;
const BG = '#f8fafc';
/**
 * html2canvas measures each font's baseline with this 1x1 image placed inline next to a text, in the live page. The
 * global `img { display: block }` (styles.css) breaks that measurement and every text is drawn too low (clipped under
 * its box); while a capture runs, this one image is put back inline.
 */
const H2C_METRICS_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** yyyy-MM-dd of today (for file names). */
export function fileDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "CEO dashboard" + "1 Oct - 15 Oct 2026" -> "CEO-dashboard-1-Oct-15-Oct-2026" (letters, digits and dashes only). */
export function fileSlug(...parts: string[]): string {
  return parts.join(' ').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'export';
}

export async function exportPagePdf(el: HTMLElement, opts: PagePdfOptions): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const hide = ['.no-print', opts.hide].filter(Boolean).join(', ');

  // Where a page may end: the edges of the blocks, in CSS pixels from the top of the element, measured in the copy
  // html2canvas draws (its frame can be a few pixels narrower than the window, so lines wrap a little differently
  // than on screen). A section title stays with the start of what follows it.
  type Edge = { t: number; b: number };
  const measure = (root: HTMLElement): { blocks: Edge[]; w: number; h: number } => {
    const top = root.getBoundingClientRect().top;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(opts.blocks ?? DEFAULT_BLOCKS))
      .filter(b => b.offsetParent !== null)
      .map(b => {
        const r = b.getBoundingClientRect();
        return { t: r.top - top, b: r.bottom - top + (b.classList.contains('section-title') ? 120 : 0) };
      })
      .filter(r => r.b > r.t);
    return { blocks, w: root.scrollWidth, h: root.scrollHeight };
  };
  let layout = measure(el);
  const scale = Math.max(0.5, Math.min(2, Math.sqrt(MAX_PIXELS / Math.max(1, layout.w * layout.h)), MAX_SIDE / Math.max(1, layout.h)));
  const fix = document.createElement('style');
  fix.textContent = `img[src="${H2C_METRICS_IMG}"] { display: inline !important; }`;
  document.head.appendChild(fix);
  el.setAttribute('data-pdf-root', '');
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, {
      scale, useCORS: true, backgroundColor: BG, logging: false,
      onclone: (doc: Document) => {
        const style = doc.createElement('style');
        // Blank out the controls, and no animation or dimming caught half way.
        style.textContent = `${hide} { visibility: hidden !important; }
          * { animation: none !important; transition: none !important; }
          .is-refreshing { opacity: 1 !important; }`;
        doc.head.appendChild(style);
        const copy = doc.querySelector<HTMLElement>('[data-pdf-root]');
        if (copy && copy.scrollWidth > 0) layout = measure(copy);
      }
    });
  } finally {
    fix.remove();
    el.removeAttribute('data-pdf-root');
  }
  const { blocks } = layout;
  const cssH = layout.h;
  // Canvas pixels per CSS pixel of the copy (html2canvas rounds the canvas size).
  const px = canvas.width / Math.max(1, layout.w);

  const pdf = new jsPDF({ orientation: opts.orientation ?? 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentW = pageW - margin * 2;
  const mmPerCss = contentW / layout.w;

  // Header on the first page.
  let y = margin;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(15, 23, 42);
  pdf.text(opts.title, margin, y + 5);
  y += 8;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(71, 85, 105);
  for (const line of [...(opts.lines ?? []).filter(Boolean),
    `Generated ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`]) {
    pdf.text(line, margin, y + 3.5);
    y += 4.8;
  }
  pdf.setDrawColor(13, 148, 136); pdf.setLineWidth(0.6); pdf.line(margin, y + 1, pageW - margin, y + 1);
  y += 4;

  // Slices: as tall as the space left on the page allows, ending between blocks where possible.
  const footer = 6;
  let start = 0;   // CSS px
  let page = 0;
  while (start < cssH - 1) {
    const room = (pageH - margin - footer - y) / mmPerCss;   // CSS px that fit on this page
    let end = Math.min(cssH, start + room);
    if (end < cssH) {
      // The latest block edge inside the slice that does not cut a block (smaller than a page) in two.
      const inside = (c: number) => blocks.some(r => r.t < c - 1 && r.b > c + 1 && r.b - r.t < room);
      const edges = blocks.flatMap(r => [r.t, r.b]).filter(c => c > start + room * 0.35 && c <= end && !inside(c));
      if (edges.length) end = Math.max(...edges);
    }
    const sy = Math.round(start * px);
    const sh = Math.max(1, Math.min(canvas.height - sy, Math.round((end - start) * px)));
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = sh;
    const ctx = part.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    if (page > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, y, contentW, (sh / px) * mmPerCss);
    page++;
    start = end;
    y = margin;
  }

  // Page numbers.
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(148, 163, 184);
    pdf.text(opts.title, margin, pageH - margin / 2);
    pdf.text(`Page ${i} of ${pages}`, pageW - margin, pageH - margin / 2, { align: 'right' });
  }
  pdf.save(opts.fileName.endsWith('.pdf') ? opts.fileName : `${opts.fileName}.pdf`);
}
