import { toStatusKey } from '../lib/status'

const MAP = {
  open:     { fg: 'var(--status-open-fg)', bg: 'var(--status-open-bg)', dot: 'var(--status-open-dot)', label: 'รอดำเนินการ' },
  done:     { fg: 'var(--status-done-fg)', bg: 'var(--status-done-bg)', dot: 'var(--status-done-dot)', label: 'ซักเสร็จ' },
  received: { fg: 'var(--status-recv-fg)', bg: 'var(--status-recv-bg)', dot: 'var(--status-recv-dot)', label: 'รับผ้าแล้ว' },
}

export default function StatusBadge({ status = 'open', size = 'md', style }) {
  const key = MAP[status] ? status : toStatusKey(status)
  const c = MAP[key] || MAP.open
  const sz = size === 'sm'
    ? { pad: '3px 8px', fs: 'var(--fs-caption)', dot: 6 }
    : { pad: '5px 12px', fs: 'var(--fs-sub)', dot: 7 }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: sz.pad, background: c.bg, color: c.fg,
      fontFamily: 'var(--font-sans)', fontSize: sz.fs, fontWeight: 'var(--fw-semibold)',
      lineHeight: 1, borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', ...style,
    }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {c.label}
    </span>
  )
}
