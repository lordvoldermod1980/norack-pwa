// Date conversion at the API boundary. The new cloud backend stores/returns ISO (yyyy-mm-dd); the UI
// displays + accepts Buddhist dd/mm/yyyy (พ.ศ.). The norack.js adapter converts here so components keep
// using พ.ศ. unchanged. See docs/phase6-frontend-cutover.md (backend repo).

/** ISO "yyyy-mm-dd" (or full ISO datetime) → Buddhist "dd/mm/yyyy". '' for empty; passes non-ISO through. */
export function isoToThai(iso) {
  const s = String(iso ?? '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s // not ISO (maybe already Thai) → leave as-is
  return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`
}

/** Buddhist "dd/mm/yyyy" (พ.ศ.) → ISO "yyyy-mm-dd". '' for empty; passes an already-ISO value through.
 *  Year > 2400 is treated as Buddhist (−543); otherwise assumed already CE. */
export function thaiToIso(thai) {
  const s = String(thai ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10) // already ISO
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return '' // unrecognized → empty (don't pass junk to the backend)
  let y = Number(m[3])
  if (y > 2400) y -= 543
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
}
