// Renders a tabular report as either:
//   - HTML (print-friendly, auto-triggers Save-as-PDF dialog)
//   - Excel (HTML-as-XLS — Excel opens HTML tables natively with formatting)
//
// Usage:
//   send(res, 200, renderHtml({ title, period, columns, rows, totals }), {
//     'Content-Type': 'text/html; charset=utf-8'
//   });

import { formatRiyadhDateTime, toRiyadhDate } from './date.js';

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const SAR = (h) => {
  if (h == null) return '0.00';
  const n = Number(h);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
};

// Common print stylesheet — Brave-themed report.
const CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Tajawal', 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #0f1320;
  background: #fff;
  font-size: 12px;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.wrap { max-width: 100%; padding: 16px; }

/* Header */
.report-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  border-bottom: 2px solid #0f1320;
  padding-bottom: 12px;
  margin-bottom: 18px;
}
.brand-block { display: flex; align-items: center; gap: 12px; }
.brand-logo {
  width: 44px; height: 44px;
  border-radius: 8px;
  background: #0f1320; color: #fff;
  display: grid; place-items: center;
  font-weight: 700; font-size: 22px;
  letter-spacing: -0.02em;
}
.brand-name { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
.brand-name small { display: block; font-size: 11px; color: #5b6175; font-weight: 500; }

.meta { text-align: end; font-size: 11px; color: #5b6175; }
.meta .num { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }

/* Title section */
.title-block {
  background: #f5f6f9;
  border-inline-start: 3px solid #0f1320;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 0 8px 8px 0;
}
.title-block h1 {
  margin: 0 0 4px;
  font-size: 18px; font-weight: 700;
  letter-spacing: -0.02em;
  color: #0f1320;
}
.title-block .sub {
  font-size: 12px;
  color: #5b6175;
  display: flex; gap: 16px; flex-wrap: wrap;
}
.title-block .sub strong { color: #0f1320; font-weight: 600; }

/* Stats summary */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.stat {
  background: #fff;
  border: 1px solid #eef0f5;
  border-radius: 8px;
  padding: 10px 12px;
}
.stat .k { font-size: 10px; color: #5b6175; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
.stat .v { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 16px; font-weight: 700; color: #0f1320; letter-spacing: -0.02em; }

/* Table */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background: #fff;
}
table thead th {
  background: #0f1320; color: #fff;
  text-align: start;
  padding: 8px 10px;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid #0f1320;
}
table tbody td {
  padding: 7px 10px;
  border: 1px solid #eef0f5;
  vertical-align: top;
}
table tbody tr:nth-child(even) td { background: #fafbfc; }
table tbody tr:hover td { background: #f5f6f9; }
table td.num, table th.num {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  text-align: end;
  white-space: nowrap;
}
table tfoot td {
  background: #0f1320; color: #fff;
  padding: 9px 10px;
  font-weight: 700;
  border: 1px solid #0f1320;
}
table tfoot td.num {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  text-align: end;
}

/* Pills (status) inside tables */
.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}
.pill.confirmed { background: #bcf0c0; color: #107a3a; }
.pill.pending   { background: #ffe89a; color: #854d0e; }
.pill.rejected  { background: #fbc4bd; color: #9b2118; }
.pill.in        { background: #bcf0c0; color: #107a3a; }
.pill.out       { background: #fbc4bd; color: #9b2118; }

.pos { color: #107a3a; }
.neg { color: #9b2118; }
.zero { color: #5b6175; }

/* Empty */
.empty {
  text-align: center;
  padding: 40px 20px;
  color: #5b6175;
  font-size: 13px;
  border: 1px dashed #eef0f5;
  border-radius: 8px;
}

/* Footer with print/back actions (hidden when printing) */
.actions {
  position: fixed;
  bottom: 16px; inset-inline-end: 16px;
  display: flex; gap: 8px;
  z-index: 100;
}
.actions button {
  background: #0f1320; color: #fff;
  border: 0; padding: 10px 18px;
  border-radius: 8px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; box-shadow: 0 8px 24px rgba(15,17,22,.20);
  letter-spacing: -0.01em;
}
.actions button.ghost { background: #fff; color: #0f1320; border: 1px solid #eef0f5; }
.actions button:hover { opacity: .92; }

@media print {
  .actions { display: none !important; }
  body { background: #fff; }
  .wrap { padding: 0; }
  table tbody tr:hover td { background: transparent !important; }
}
`;

// Render an HTML report — opens with auto-print prompt.
export function renderHtml({ title, period, filters, columns, rows, totals, stats, autoprint = true }) {
  const today = formatRiyadhDateTime(Date.now());
  const filterLine = (filters || []).filter(Boolean).join(' · ');

  const head = `<thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>`;

  const body = rows && rows.length
    ? `<tbody>${rows.map((row) => `<tr>${columns.map((c) => {
        const v = typeof c.format === 'function' ? c.format(row[c.key], row) : row[c.key];
        return `<td class="${c.cls || ''}">${v == null ? '' : v}</td>`;
      }).join('')}</tr>`).join('')}</tbody>`
    : '';

  const foot = totals
    ? `<tfoot><tr>${columns.map((c, i) => {
        if (i === 0) return `<td>الإجمالي (${rows ? rows.length : 0} سجل)</td>`;
        const v = totals[c.key];
        if (v == null) return `<td></td>`;
        return `<td class="${c.cls || ''}">${typeof c.format === 'function' ? c.format(v) : v}</td>`;
      }).join('')}</tr></tfoot>`
    : '';

  const statsHtml = stats && stats.length
    ? `<div class="stats">${stats.map((s) =>
        `<div class="stat"><div class="k">${esc(s.label)}</div><div class="v ${s.cls || ''}">${esc(s.value)}</div></div>`
      ).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — إقفال</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="report-head">
      <div class="brand-block">
        <div class="brand-logo">إ</div>
        <div class="brand-name">إقفال<small>تقفيل اليوميات</small></div>
      </div>
      <div class="meta">
        <div>تاريخ الطباعة</div>
        <div class="num">${esc(today)}</div>
      </div>
    </div>

    <div class="title-block">
      <h1>${esc(title)}</h1>
      <div class="sub">
        ${period ? `<span><strong>الفترة:</strong> ${esc(period)}</span>` : ''}
        ${filterLine ? `<span>${esc(filterLine)}</span>` : ''}
      </div>
    </div>

    ${statsHtml}

    ${rows && rows.length
      ? `<table>${head}${body}${foot}</table>`
      : `<div class="empty">لا توجد سجلات لهذه الفترة.</div>`
    }
  </div>

  <div class="actions">
    <button onclick="window.print()">🖨 طباعة / حفظ PDF</button>
    <button class="ghost" onclick="window.close() || history.back()">↶ رجوع</button>
  </div>

  ${autoprint ? `<script>setTimeout(() => window.print(), 450);</script>` : ''}
</body>
</html>`;
}

// Render the same data as HTML-formatted Excel (.xls).
// Excel opens HTML tables with most styling preserved.
export function renderExcel({ title, period, columns, rows, totals }) {
  const head = `<tr style="background:#0f1320;color:#fff;font-weight:700">${columns.map((c) =>
    `<th>${esc(c.label)}</th>`
  ).join('')}</tr>`;
  const body = (rows || []).map((row) =>
    `<tr>${columns.map((c) => {
      const v = typeof c.format === 'function' ? c.format(row[c.key], row, true) : row[c.key];
      const isNum = c.cls && c.cls.includes('num');
      const cellStyle = isNum ? 'mso-number-format:"#,##0.00";text-align:end;font-family:Consolas,monospace' : '';
      return `<td style="${cellStyle}">${v == null ? '' : v}</td>`;
    }).join('')}</tr>`
  ).join('');
  const foot = totals
    ? `<tr style="background:#0f1320;color:#fff;font-weight:700">${columns.map((c, i) => {
        if (i === 0) return `<td>الإجمالي</td>`;
        const v = totals[c.key];
        return `<td style="text-align:end">${v == null ? '' : (typeof c.format === 'function' ? c.format(v) : v)}</td>`;
      }).join('')}</tr>`
    : '';

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>${esc(title.slice(0, 30))}</x:Name>
          <x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: Tahoma, Arial, sans-serif; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #ddd; padding: 6px 10px; }
  </style>
</head>
<body>
  <table dir="rtl">
    <tr><td colspan="${columns.length}" style="font-weight:700;font-size:14px">إقفال — ${esc(title)}</td></tr>
    ${period ? `<tr><td colspan="${columns.length}" style="color:#5b6175;font-size:11px">الفترة: ${esc(period)}</td></tr>` : ''}
    <tr><td colspan="${columns.length}">&nbsp;</td></tr>
    ${head}
    ${body}
    ${foot}
  </table>
</body>
</html>`;
}

// Helper: parse YYYY-MM-DD or fallback.
export function parseDateRange(req) {
  const from = req.query.from ? Date.parse(req.query.from + 'T00:00:00.000Z') - 3 * 3600 * 1000 : 0;
  const to = req.query.to
    ? Date.parse(req.query.to + 'T00:00:00.000Z') - 3 * 3600 * 1000 + 24 * 3600 * 1000 - 1
    : Date.now();
  const periodFrom = req.query.from || toRiyadhDate(0);
  const periodTo = req.query.to || toRiyadhDate(Date.now());
  return { from, to, period: `${periodFrom} → ${periodTo}` };
}

// Common: choose Content-Type + Content-Disposition based on format.
export function exportHeaders(format, baseName) {
  const safeName = baseName.replace(/[^a-zA-Z0-9_؀-ۿ-]/g, '_');
  if (format === 'excel') {
    return {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}.xls"`,
    };
  }
  // HTML (also used for PDF — browser saves as PDF)
  return { 'Content-Type': 'text/html; charset=utf-8' };
}

// Re-export helpers used by report endpoints.
export { SAR, esc, formatRiyadhDateTime, toRiyadhDate };
