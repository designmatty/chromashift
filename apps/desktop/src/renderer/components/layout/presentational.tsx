import type { ReactNode } from 'react'
import { Palette } from 'lucide-react'

export function Brand(): React.JSX.Element {
  return (
    <div className="brand">
      <div className="brand-mark" />
      <strong>ChromaShift</strong>
    </div>
  )
}

export function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick(): void
}): React.JSX.Element {
  return (
    <button className={active ? 'nav active' : 'nav'} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function SectionTitle({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

export function Empty({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="empty">
      <Palette />
      <h2>{title}</h2>
    </div>
  )
}

export function SettingsRow({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </div>
  )
}
