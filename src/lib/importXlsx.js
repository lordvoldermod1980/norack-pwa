// Parse a backup .xlsx (as produced by the Export button) back into the { headers, rows } shape the
// /api/import endpoint expects. SheetJS is dynamic-import()ed (shared lazy chunk with exportXlsx). Values
// are read as formatted TEXT (raw:false) so the strings come back exactly as stored. Phase 10b.
export async function parseBackupXlsx(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheets = {}
  for (const name of ['customers', 'bills', 'bill_positions']) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    if (!aoa.length) continue
    const headers = (aoa[0] || []).map((h) => String(h ?? ''))
    const rows = aoa.slice(1)
      .map((r) => headers.map((_, i) => String(r[i] ?? '')))
      .filter((r) => r.some((c) => c !== '')) // drop fully-empty rows
    sheets[name] = { headers, rows }
  }
  if (!sheets.customers && !sheets.bills) {
    throw new Error('ไฟล์นี้ไม่มีแท็บ customers / bills — เลือกไฟล์ backup ที่ export จากระบบ')
  }
  return sheets
}
