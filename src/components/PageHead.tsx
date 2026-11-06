import type { ReactNode } from 'react'

export default function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head rise">
      <div className="stack" style={{ ['--gap' as string]: '6px' }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row wrap" style={{ gap: 8 }}>{actions}</div>}
    </header>
  )
}
