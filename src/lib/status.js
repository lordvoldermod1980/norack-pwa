// Map Thai sheet status values → design status keys
export const toStatusKey = (s = '') => {
  if (s === 'เสร็จสิ้น' || s === 'ซักเสร็จ' || s === 'done') return 'done'
  if (s === 'รับแล้ว' || s === 'received') return 'received'
  return 'open'
}
