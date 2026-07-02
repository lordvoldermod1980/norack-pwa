import { useState } from 'react'

export default function PhotoThumb({ src, alt = 'รูปผ้า', size = 88, radius = 'var(--radius-md)', seq, onClick, style }) {
  const [state, setState] = useState(src ? 'loading' : 'empty')
  // reset load state when src changes (render-time adjustment, no effect needed)
  const [trackedSrc, setTrackedSrc] = useState(src)
  if (src !== trackedSrc) {
    setTrackedSrc(src)
    setState(src ? 'loading' : 'empty')
  }

  return (
    <div onClick={onClick} style={{
      position: 'relative', width: size, height: size, flexShrink: 0,
      borderRadius: radius, overflow: 'hidden',
      background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)',
      cursor: onClick ? 'pointer' : 'default', ...style,
    }}>
      {src && state !== 'error' && (
        <img src={src} alt={alt} loading="lazy"
          onLoad={() => setState('ok')} onError={() => setState('error')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            opacity: state === 'ok' ? 1 : 0, transition: 'opacity var(--dur-base) var(--ease-out)' }} />
      )}
      {state === 'loading' && (
        <span style={{ position: 'absolute', inset: 0,
          background: 'linear-gradient(100deg, var(--surface-sunken) 30%, var(--gray-200) 50%, var(--surface-sunken) 70%)',
          backgroundSize: '200% 100%', animation: 'norack-shimmer 1.2s ease-in-out infinite' }} />
      )}
      {(state === 'empty' || state === 'error') && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 4,
          color: 'var(--text-faint)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-5-5L5 21" />
          </svg>
          <span>{state === 'error' ? 'โหลดไม่ได้' : 'ไม่มีรูป'}</span>
        </span>
      )}
      {seq != null && (
        <span style={{ position: 'absolute', left: 5, top: 5, padding: '1px 7px',
          background: 'rgba(22,22,28,0.62)', color: '#fff', fontFamily: 'var(--font-mono)',
          fontSize: 11, fontWeight: 'var(--fw-medium)', borderRadius: 'var(--radius-pill)' }}>
          #{seq}
        </span>
      )}
    </div>
  )
}
