// Build a fidelity-safe .xlsx from the /api/export/backup payload and save it via the browser's save
// dialog (falls back to a normal download). Every cell is written as TEXT (t:'s' + number-format '@') so
// Google Sheets / Excel never auto-convert phones (leading 0), 18-digit customer_id (sci-notation) or
// ISO dates. Phase 10c — see backend docs/phase10-backup-turso-to-sheets.md.
// SheetJS is heavy (~400 kB) so it's loaded on demand (dynamic import) — the initial PWA bundle stays lean.

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// aoa_to_sheet already makes string cells for our (all-string) values; we still force t/z as insurance.
function textSheet(XLSX, headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell) { cell.t = 's'; cell.v = cell.v == null ? '' : String(cell.v); cell.z = '@' }
    }
  }
  ws['!freeze'] = { xSplit: 0, ySplit: 1 } // freeze header row (best-effort)
  return ws
}

/** Turn the export payload into an .xlsx and save it. Resolves with { filename }; throws AbortError if
 *  the user cancels the save dialog (callers should ignore that). */
export async function saveBackupXlsx(payload) {
  const XLSX = await import('xlsx') // load SheetJS on demand (keeps it out of the initial bundle)
  const sheets = payload?.sheets || {}
  const wb = XLSX.utils.book_new()
  for (const name of ['customers', 'bills', 'bill_positions']) {
    const s = sheets[name]
    if (s?.headers) XLSX.utils.book_append_sheet(wb, textSheet(XLSX, s.headers, s.rows || []), name)
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: XLSX_MIME })
  const today = new Date().toISOString().slice(0, 10)
  const filename = `NO.Rack-backup-${today}.xlsx`

  // Modern browsers: real "choose where to save" dialog (local folder or a Drive-synced folder).
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'Excel workbook', accept: { [XLSX_MIME]: ['.xlsx'] } }],
    })
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
  } else {
    // Fallback: normal download (goes to the browser's Downloads folder).
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  return { filename }
}
