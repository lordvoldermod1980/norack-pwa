const VARIANTS = {
  primary: { background: 'var(--brand)', color: 'var(--text-on-brand)', border: '1px solid transparent', boxShadow: 'var(--shadow-brand)' },
  secondary: { background: 'var(--brand-tint)', color: 'var(--text-brand)', border: '1px solid transparent', boxShadow: 'none' },
  outline: { background: 'var(--surface-card)', color: 'var(--text-body)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xs)' },
  ghost: { background: 'transparent', color: 'var(--text-brand)', border: '1px solid transparent', boxShadow: 'none' },
}

export default function NRButton({ children, variant = 'primary', size = 'md', block = false,
  disabled = false, loading = false, iconLeft = null, onClick, style }) {
  const h = size === 'sm' ? 40 : size === 'lg' ? 'var(--tap-large)' : 'var(--tap-min)'
  const fs = size === 'sm' ? 'var(--fs-sub)' : 'var(--fs-body)'
  const px = size === 'sm' ? '0 14px' : '0 20px'
  const r = size === 'sm' ? 'var(--radius-sm)' : 'var(--radius-md)'
  const v = VARIANTS[variant] || VARIANTS.primary
  const off = disabled || loading

  return (
    <button onClick={onClick} disabled={off} style={{
      display: block ? 'flex' : 'inline-flex', width: block ? '100%' : 'auto',
      alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
      height: h, padding: px, fontFamily: 'var(--font-sans)', fontSize: fs,
      fontWeight: 'var(--fw-semibold)', lineHeight: 1, borderRadius: r,
      cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1,
      transition: 'transform var(--dur-fast)', WebkitTapHighlightColor: 'transparent',
      ...v, ...style,
    }}
    onMouseDown={e => { if (!off) e.currentTarget.style.transform = 'scale(0.97)' }}
    onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
      {loading
        ? <span style={{ width:18, height:18, borderRadius:'50%', border:'2px solid currentColor',
            borderTopColor:'transparent', display:'inline-block', animation:'norack-spin 0.7s linear infinite' }} />
        : iconLeft}
      {children}
    </button>
  )
}
