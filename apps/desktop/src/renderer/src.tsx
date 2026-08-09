import { Component, StrictMode, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ColorProfile, ColorSettings } from '@chromashift/core'
import {
  AppWindow,
  ArrowLeft,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  FolderOpen,
  Monitor,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { AppPanelView, ApplicationSelection, ChromaShiftApi, ProductError, ProductResult, ProductState } from '../shared/product-api.js'
import './styles.css'

declare global { interface Window { chromaShift: ChromaShiftApi } }

type ColorKey = keyof ColorSettings
type MainView = AppPanelView
const DEFAULT_ID = 'default'
const controls: Array<{ key: ColorKey; label: string; min: number; max: number; step: number; initial: number }> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'gamma', label: 'Gamma', min: .5, max: 2.8, step: .05, initial: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'hue', label: 'Hue', min: 0, max: 100, step: 1, initial: 50 },
  { key: 'colorTemperature', label: 'Color temperature', min: 0, max: 100, step: 1, initial: 50 }
]

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  public override state = { error: null as Error | null }
  public static getDerivedStateFromError(error: Error): { error: Error } { return { error } }
  public override componentDidCatch(error: Error, info: ErrorInfo): void { console.error(error, info) }
  public override render(): ReactNode {
    return this.state.error === null ? this.props.children : <div className="center-state" role="alert"><h1>ChromaShift could not render</h1><p>{this.state.error.message}</p><Button onClick={() => location.reload()}>Reload</Button></div>
  }
}

function useProduct(): { state: ProductState | null; error: ProductError | null; setState: (state: ProductState) => void } {
  const [state, setState] = useState<ProductState | null>(null)
  const [error, setError] = useState<ProductError | null>(null)
  useEffect(() => {
    void window.chromaShift.getState().then((result) => result.ok ? setState(result.value) : setError(result.error))
    window.chromaShift.onStateChanged(setState)
  }, [])
  return { state, error, setState }
}

function Root(): React.JSX.Element {
  const product = useProduct()
  if (product.error !== null) return <div className="center-state" role="alert"><h1>ChromaShift could not start</h1><p>{product.error.message}</p></div>
  if (product.state === null) return <div className="center-state" aria-busy="true"><div className="spinner" /><p>Connecting to DisplayService…</p></div>
  return new URLSearchParams(location.search).get('panel') === 'mini'
    ? <MiniPanel product={product.state} />
    : <MainApp product={product.state} />
}

function MainApp({ product }: { product: ProductState }): React.JSX.Element {
  const [view, setView] = useState<MainView>('profiles')
  const [selectedId, setSelectedId] = useState(product.configuration.profiles[0]?.id ?? null)
  const [draft, setDraft] = useState<ColorProfile | null>(null)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = product.configuration.profiles.find((profile) => profile.id === selectedId) ?? product.configuration.profiles[0] ?? null
  const activeSession = product.preview.state === 'active' ? product.preview : null
  const temporaryOverride = activeSession?.kind === 'override' ? activeSession : null

  useTheme(product.settings.theme)
  useEffect(() => { if (!editing && selected !== null) setDraft(structuredClone(selected)) }, [selected, editing])

  const draftSignature = JSON.stringify(draft)
  useEffect(() => {
    if (!editing || draft === null || draft.displays.length === 0) return
    if (activeSession?.kind !== 'edit' && Object.keys(draft.color).length === 0) return
    const timer = setTimeout(() => {
      const request = activeSession?.kind === 'edit' && activeSession.profileId === draft.id
        ? window.chromaShift.updatePreview(draft.id, draft.color, draft.displays.map((item) => item.displayId))
        : window.chromaShift.startPreview(draft, 'edit')
      void run(request, setError)
    }, 120)
    return () => clearTimeout(timer)
  }, [editing, draftSignature, activeSession?.kind, activeSession?.profileId])

  async function action<T>(request: Promise<ProductResult<T>>, done?: (value: T) => void): Promise<void> {
    setBusy(true); setError(null)
    const value = await run(request, setError)
    if (value !== undefined) done?.(value)
    setBusy(false)
  }

  async function selectProfile(profile: ColorProfile): Promise<void> {
    if (editing && dirty && !confirm('Discard the changes to this profile?')) return
    if (editing && activeSession?.kind === 'edit') await run(window.chromaShift.cancelPreview(), setError)
    setSelectedId(profile.id); setDraft(structuredClone(profile)); setEditing(false); setDirty(false)
  }

  async function navigate(nextView: MainView): Promise<void> {
    if (nextView === view) return
    if (editing && dirty && !confirm('Discard the changes to this profile?')) return
    if (editing && activeSession?.kind === 'edit') {
      await run(window.chromaShift.cancelPreview(), setError)
    }
    setDraft(selected === null ? null : structuredClone(selected))
    setEditing(false)
    setDirty(false)
    setView(nextView)
  }

  useEffect(() => {
    window.chromaShift.onAppPanelNavigation((nextView) => void navigate(nextView))
  })

  async function beginEdit(): Promise<void> {
    if (activeSession?.kind === 'preview') await run(window.chromaShift.cancelPreview(), setError)
    setDraft(structuredClone(selected)); setEditing(true); setDirty(false)
  }

  async function cancelEdit(): Promise<void> {
    if (activeSession?.kind === 'edit') await run(window.chromaShift.cancelPreview(), setError)
    setDraft(selected === null ? null : structuredClone(selected)); setEditing(false); setDirty(false)
  }

  const shownProfile = draft ?? selected
  const shownColor = !editing && temporaryOverride !== null && temporaryOverride.profileId === shownProfile?.id
    ? temporaryOverride.color
    : shownProfile?.color ?? {}

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav>
        <NavButton active={view === 'profiles'} icon={<Palette />} label="Profiles" onClick={() => void navigate('profiles')} />
        <NavButton active={view === 'displays'} icon={<Monitor />} label="Displays" onClick={() => void navigate('displays')} />
        <NavButton active={view === 'settings'} icon={<SettingsIcon />} label="Settings" onClick={() => void navigate('settings')} />
      </nav>
    </aside>
    <main className="main-panel">
      {error !== null && <div className="error-banner" role="alert"><span>{error.message}</span><button onClick={() => setError(null)}><X /></button></div>}
      {temporaryOverride !== null && <div className="override-banner"><div><strong>Temporary overrides active</strong><span>The applied values differ from the saved profile.</span></div><Button variant="outline" onClick={() => void action(window.chromaShift.cancelPreview())}><RotateCcw />Reset changes</Button><Button onClick={() => { const profile = product.configuration.profiles.find((item) => item.id === temporaryOverride.profileId); if (profile !== undefined) void action(window.chromaShift.confirmPreview({ ...profile, color: temporaryOverride.color }, 'preserve')) }}><Save />Update profile</Button></div>}
      {view === 'profiles' && <div className="profile-workspace">
        <ProfileList profiles={product.configuration.profiles} selectedId={shownProfile?.id ?? null} onSelect={(profile) => void selectProfile(profile)} onCreate={() => void action(window.chromaShift.createProfile('New profile'), (profile) => { setSelectedId(profile.id); setDraft(profile); setEditing(true) })} />
        {shownProfile === null ? <Empty title="No profile selected" /> : <ProfileDetail
          profile={shownProfile} color={shownColor} product={product} editing={editing} busy={busy} dirty={dirty}
          previewing={activeSession?.kind === 'preview' && activeSession.profileId === shownProfile.id}
          onEdit={() => void beginEdit()}
          onChange={(profile) => { setDraft(profile); setDirty(true) }}
          onCancel={() => void cancelEdit()}
          onSave={() => void action(activeSession?.kind === 'edit' ? window.chromaShift.confirmPreview(shownProfile, 'manual') : window.chromaShift.saveProfile(shownProfile), (saved) => { setDraft(saved); setEditing(false); setDirty(false) })}
          onPreview={() => void action(activeSession?.kind === 'preview' ? window.chromaShift.cancelPreview() : window.chromaShift.startPreview(shownProfile, 'preview'))}
          onCopy={() => void action(window.chromaShift.duplicateProfile(shownProfile.id), (copy) => { setSelectedId(copy.id); setDraft(copy) })}
          onDelete={() => { if (confirm(`Delete “${shownProfile.name}”?`)) void action(window.chromaShift.deleteProfile(shownProfile.id), () => setSelectedId(DEFAULT_ID)) }}
          onEnabled={(enabled) => void action(window.chromaShift.saveProfile({ ...shownProfile, enabled }))}
          onError={setError}
        />}
      </div>}
      {view === 'displays' && <Displays product={product} />}
      {view === 'settings' && <SettingsPanel product={product} onError={setError} />}
    </main>
  </div>
}

function ProfileList({ profiles, selectedId, onSelect, onCreate }: { profiles: ColorProfile[]; selectedId: string | null; onSelect(profile: ColorProfile): void; onCreate(): void }): React.JSX.Element {
  return <section className="profile-list"><header><strong>Profiles</strong><Badge variant="secondary">{profiles.length}</Badge></header><div className="profile-items">{profiles.map((profile) => <button className={profile.id === selectedId ? 'profile-item selected' : 'profile-item'} key={profile.id} onClick={() => onSelect(profile)}><span className="profile-icon"><Palette /></span><span><strong>{profile.name}</strong><small>{profile.id === DEFAULT_ID ? 'Global profile' : `${profile.applications.length} application${profile.applications.length === 1 ? '' : 's'}`}</small></span>{!profile.enabled && <Badge variant="outline">Off</Badge>}</button>)}</div><Button size="sm" variant="outline" onClick={onCreate}><Plus />New profile</Button></section>
}

interface DetailProps { profile: ColorProfile; color: ColorSettings; product: ProductState; editing: boolean; busy: boolean; dirty: boolean; previewing: boolean; onEdit(): void; onChange(profile: ColorProfile): void; onCancel(): void; onSave(): void; onPreview(): void; onCopy(): void; onDelete(): void; onEnabled(value: boolean): void; onError(error: ProductError | null): void }
function ProfileDetail(props: DetailProps): React.JSX.Element {
  const p = props.profile
  return <section className="profile-detail">
    <header className="detail-header"><div><div className="title-row">{props.editing && p.id !== DEFAULT_ID ? <Input className="profile-name-input" value={p.name} maxLength={100} aria-label="Profile name" onChange={(event) => props.onChange({ ...p, name: event.target.value })} /> : <h1>{p.name}</h1>}{p.id === DEFAULT_ID && <Badge>Global profile</Badge>}</div><p>{p.id === DEFAULT_ID ? 'The catch-all profile for applications without assignments.' : 'Activates when an assigned application is in the foreground.'}</p></div><div className="header-actions"><Switch checked={p.enabled} disabled={p.id === DEFAULT_ID || props.editing} onCheckedChange={props.onEnabled} aria-label="Profile enabled" />{props.editing ? <><Button variant="outline" onClick={props.onCancel}>Cancel</Button><Button disabled={!props.dirty || props.busy || p.name.trim().length === 0} onClick={props.onSave}><Check />Save</Button></> : <><Button variant={props.previewing ? 'secondary' : 'outline'} onClick={props.onPreview}>{props.previewing ? <><RotateCcw />Stop preview</> : <><SlidersHorizontal />Preview</>}</Button><Button onClick={props.onEdit}><Edit3 />Edit</Button><Button variant="ghost" size="icon" onClick={props.onCopy} aria-label="Copy profile"><Copy /></Button>{p.id !== DEFAULT_ID && <Button variant="ghost" size="icon" onClick={props.onDelete} aria-label="Delete profile"><Trash2 /></Button>}</>}</div></header>
    <Separator />
    <section className="detail-section"><SectionTitle title="Displays" description="All selected displays receive the same supported settings." /><div className="display-options">{props.product.displays.map((display) => { const checked = p.displays.some((item) => item.displayId === display.id); return <label className={checked ? 'display-option checked' : 'display-option'} key={display.id}><Checkbox checked={checked} disabled={!props.editing} onCheckedChange={(value) => props.onChange({ ...p, displays: value ? [...p.displays, { displayId: display.id }] : p.displays.filter((item) => item.displayId !== display.id) })} /><Monitor /><span><strong>{display.name}</strong><small>{display.adapter.name} · {display.primary ? 'Primary' : display.connection}</small></span></label> })}</div></section>
    <Separator />
    <section className="detail-section"><SectionTitle title="Color controls" description={props.editing ? 'Changes are previewed live on every selected display.' : 'Enter Edit mode to change these values.'} /><ColorControls profile={p} color={props.color} product={props.product} editable={props.editing} onChange={(color) => props.onChange({ ...p, color })} /></section>
    {p.id !== DEFAULT_ID && <><Separator /><section className="detail-section"><ApplicationAssignments profile={p} editing={props.editing} onChange={props.onChange} onError={props.onError} /></section></>}
  </section>
}

function ColorControls({ profile, color, product, editable, onChange, compact = false }: { profile: ColorProfile; color: ColorSettings; product: ProductState; editable: boolean; onChange(color: ColorSettings): void; compact?: boolean }): React.JSX.Element {
  return <div className={compact ? 'controls compact' : 'controls'}>{controls.map((control) => {
    const support = controlSupport(control.key, profile, product)
    const value = color[control.key]
    const enabled = value !== undefined
    return <div className="control" key={control.key}><div className="control-label"><label><Checkbox checked={enabled} disabled={!editable || !support.available} onCheckedChange={(checked) => { const next = { ...color }; if (checked) next[control.key] = control.initial; else delete next[control.key]; onChange(next) }} /><strong>{control.label}</strong></label><span>{enabled ? formatValue(control.key, value) : 'Not overridden'}</span></div><Slider value={[value ?? control.initial]} min={control.min} max={control.max} step={control.step} disabled={!editable || !enabled || !support.available} onValueChange={(values) => { const next = Array.isArray(values) ? values[0] : values; if (next !== undefined) onChange({ ...color, [control.key]: next }) }} /><small>{support.available ? support.providers : support.reason}</small></div>
  })}</div>
}

function ApplicationAssignments({ profile, editing, onChange, onError }: { profile: ColorProfile; editing: boolean; onChange(profile: ColorProfile): void; onError(error: ProductError | null): void }): React.JSX.Element {
  const [apps, setApps] = useState<ApplicationSelection[]>([])
  async function loadApps(): Promise<void> { const result = await run(window.chromaShift.listApplications(), onError); if (result !== undefined) setApps(result) }
  function add(app: ApplicationSelection): void { if (!profile.applications.some((rule) => rule.executablePath?.toLowerCase() === app.executablePath.toLowerCase())) onChange({ ...profile, applications: [...profile.applications, { executableName: app.executableName, executablePath: app.executablePath }] }) }
  return <><div className="application-heading"><SectionTitle title="Applications" description="Choose a visible application or browse for an executable." />{editing && <div className="application-actions"><DropdownMenu onOpenChange={(open) => { if (open) void loadApps() }}><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><AppWindow />Open application</DropdownMenuTrigger><DropdownMenuContent align="end">{apps.length === 0 ? <DropdownMenuItem disabled>No visible applications</DropdownMenuItem> : apps.map((app) => <DropdownMenuItem key={app.executablePath} onClick={() => add(app)}>{app.iconDataUrl !== null ? <img src={app.iconDataUrl} /> : <AppWindow />}<span><strong>{app.friendlyName}</strong><small>{app.executableName}</small></span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" onClick={() => void run(window.chromaShift.pickApplication(), onError).then((app) => { if (app !== undefined && app !== null) add(app) })}><FolderOpen />Browse</Button></div>}</div><div className="assigned-apps">{profile.applications.length === 0 && <p>No applications assigned.</p>}{profile.applications.map((rule, index) => <div className="assigned-app" key={`${rule.executableName}-${index}`}><AppWindow /><span><strong>{rule.executableName}</strong><small>{rule.executablePath ?? 'Filename match'}</small></span>{editing && <button onClick={() => onChange({ ...profile, applications: profile.applications.filter((_, item) => item !== index) })}><X /></button>}</div>)}</div></>
}

function MiniPanel({ product }: { product: ProductState }): React.JSX.Element {
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState<ProductError | null>(null)
  const activeId = product.activation.currentTarget?.kind === 'profile' ? product.activation.currentTarget.profileId : DEFAULT_ID
  const active = product.configuration.profiles.find((profile) => profile.id === activeId) ?? product.configuration.profiles.find((profile) => profile.id === DEFAULT_ID) ?? product.configuration.profiles[0]
  const override = product.preview.state === 'active' && product.preview.kind === 'override' && product.preview.profileId === active?.id ? product.preview : null
  const [color, setColor] = useState<ColorSettings>(override?.color ?? active?.color ?? {})
  const [dirty, setDirty] = useState(override !== null)
  const signature = JSON.stringify(color)
  useTheme(product.settings.theme)
  useEffect(() => { setColor(override?.color ?? active?.color ?? {}); setDirty(override !== null) }, [active?.id, override?.profileId])
  useEffect(() => {
    if (!dirty || active === undefined || active.displays.length === 0) return
    if (override === null && Object.keys(color).length === 0) return
    const timer = setTimeout(() => {
      const request = override === null
        ? window.chromaShift.startPreview({ ...active, color }, 'override')
        : window.chromaShift.updatePreview(active.id, color, active.displays.map((item) => item.displayId))
      void run(request, setError)
    }, 100)
    return () => clearTimeout(timer)
  }, [signature, dirty, active?.id, override?.profileId])

  async function choose(profileId: string | null): Promise<void> {
    if (product.preview.state === 'active') await run(window.chromaShift.cancelPreview(), setError)
    if (profileId === null) await run(window.chromaShift.enableAutomatic(), setError)
    else await run(window.chromaShift.activateProfile(profileId), setError)
    setPicker(false); setDirty(false)
  }

  if (active === undefined) return <div className="mini-panel"><Empty title="No profiles available" /></div>
  return <div className="mini-panel">{error !== null && <div className="mini-error">{error.message}</div>}{picker ? <div className="mini-picker"><header><Button variant="ghost" size="icon-sm" onClick={() => setPicker(false)}><ArrowLeft /></Button><strong>Profile controls</strong></header><button className={product.activation.mode.kind === 'automatic' ? 'picker-row selected' : 'picker-row'} onClick={() => void choose(null)}><Checkbox checked={product.activation.mode.kind === 'automatic'} /><span>Auto switch</span><Badge variant="secondary">Recommended</Badge></button><Separator />{product.configuration.profiles.filter((profile) => profile.enabled).map((profile) => <button className={product.activation.mode.kind === 'manual' && active.id === profile.id ? 'picker-row selected' : 'picker-row'} onClick={() => void choose(profile.id)} key={profile.id}><Checkbox checked={product.activation.mode.kind === 'manual' && active.id === profile.id} /><span>{profile.name}</span>{profile.id === DEFAULT_ID && <Badge>Global</Badge>}</button>)}</div> : <><div className="mini-controls"><ColorControls profile={active} color={color} product={product} editable onChange={(next) => { setColor(next); setDirty(JSON.stringify(next) !== JSON.stringify(active.color)) }} compact /></div>{dirty && <div className="mini-save"><Button variant="secondary" onClick={() => { setColor(active.color); setDirty(false); void run(window.chromaShift.cancelPreview(), setError) }}>Reset changes</Button><Button onClick={() => void run(window.chromaShift.confirmPreview({ ...active, color }, 'preserve'), setError)}>Update profile</Button></div>}<footer><button className="active-profile" onClick={() => setPicker(true)}><SlidersHorizontal /><span><small>{product.activation.mode.kind === 'automatic' ? 'Auto switch' : 'Manually selected'}</small><strong>{active.name}</strong></span></button><IconTooltip label="Open app panel"><Button variant="ghost" size="icon" onClick={() => void window.chromaShift.openAppPanel('profiles')} aria-label="Open app panel"><ExternalLink /></Button></IconTooltip><IconTooltip label="Open settings"><Button variant="ghost" size="icon" onClick={() => void window.chromaShift.openAppPanel('settings')} aria-label="Open settings"><SettingsIcon /></Button></IconTooltip><IconTooltip label="Open displays"><Button variant="ghost" size="icon" onClick={() => void window.chromaShift.openAppPanel('displays')} aria-label="Open displays"><Monitor /></Button></IconTooltip></footer></>}</div>
}

function SettingsPanel({ product, onError }: { product: ProductState; onError(error: ProductError | null): void }): React.JSX.Element {
  const settings = product.settings
  const update = (next: typeof settings): void => { void run(window.chromaShift.updateSettings(next), onError) }
  return <section className="settings-page"><header><h1>Settings</h1><p>Control how ChromaShift starts, closes, and appears.</p></header><SettingsRow title="Launch at startup" description="Start ChromaShift when you sign in to Windows."><Switch checked={settings.launchAtStartup} onCheckedChange={(value) => update({ ...settings, launchAtStartup: value })} /></SettingsRow><SettingsRow title="Windows startup behavior" description="Choose what appears during an automatic login launch."><Select value={settings.launchBehavior} onValueChange={(value) => update({ ...settings, launchBehavior: value as 'tray' | 'app' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tray">Start in tray</SelectItem><SelectItem value="app">Show app panel</SelectItem></SelectContent></Select></SettingsRow><SettingsRow title="Close behavior" description="Choose what the window close button does."><Select value={settings.closeBehavior} onValueChange={(value) => update({ ...settings, closeBehavior: value as 'tray' | 'shutdown' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tray">Minimize to tray</SelectItem><SelectItem value="shutdown">Shut down ChromaShift</SelectItem></SelectContent></Select></SettingsRow><SettingsRow title="Theme" description="Use the Windows theme or choose one explicitly."><Select value={settings.theme} onValueChange={(value) => update({ ...settings, theme: value as 'system' | 'light' | 'dark' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select></SettingsRow><Separator /><div className="settings-actions"><Button variant="outline" onClick={() => void run(window.chromaShift.restoreBaseline(), onError)}><RotateCcw />Reset displays</Button><Button variant="outline" disabled><FolderOpen />Open logs and diagnostics</Button><small>Log-file browsing will be connected with Milestone 5 diagnostics.</small></div></section>
}

function Displays({ product }: { product: ProductState }): React.JSX.Element { return <section className="displays-page"><header><h1>Displays</h1><p>Connected hardware and resolved provider capabilities.</p></header><div className="display-grid">{product.displays.map((display) => <article key={display.id}><div className="display-title"><Monitor /><div><h2>{display.name}</h2><p>{display.adapter.name}</p></div>{display.primary && <Badge>Primary</Badge>}</div><dl><dt>Connection</dt><dd>{display.connection}</dd><dt>HDR</dt><dd>{display.hdr ? 'On' : 'Off'}</dd><dt>Refresh rate</dt><dd>{display.refreshRate} Hz</dd></dl><Separator /><div className="capabilities">{Object.entries(product.capabilityReports[display.id]?.capabilities ?? {}).map(([name, capability]) => <div key={name}><span>{formatName(name)}</span><Badge variant={capability.supported ? 'secondary' : 'outline'}>{capability.supported ? capability.provider : 'Unavailable'}</Badge></div>)}</div></article>)}</div></section> }

function Brand(): React.JSX.Element { return <div className="brand"><div className="brand-mark" /><strong>ChromaShift</strong></div> }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick(): void }): React.JSX.Element { return <button className={active ? 'nav active' : 'nav'} onClick={onClick}>{icon}<span>{label}</span></button> }
function SectionTitle({ title, description }: { title: string; description: string }): React.JSX.Element { return <div className="section-title"><h2>{title}</h2><p>{description}</p></div> }
function Empty({ title }: { title: string }): React.JSX.Element { return <div className="empty"><Palette /><h2>{title}</h2></div> }
function SettingsRow({ title, description, children }: { title: string; description: string; children: ReactNode }): React.JSX.Element { return <div className="settings-row"><div><h2>{title}</h2><p>{description}</p></div>{children}</div> }
function IconTooltip({ label, children }: { label: string; children: React.JSX.Element }): React.JSX.Element { return <Tooltip><TooltipTrigger render={children} /><TooltipContent>{label}</TooltipContent></Tooltip> }

function controlSupport(key: ColorKey, profile: ColorProfile, product: ProductState): { available: boolean; reason: string; providers: string } {
  if (profile.displays.length === 0) return { available: false, reason: 'Select a display first.', providers: '' }
  const failures: string[] = []; const providers = new Set<string>()
  for (const target of profile.displays) { const display = product.displays.find((item) => item.id === target.displayId); const capability = product.capabilityReports[target.displayId]?.capabilities[key]; if (display === undefined || capability === undefined || !capability.supported) failures.push(`${display?.name ?? target.displayId}: ${capability?.reason ?? 'Unavailable'}`); else if (display.hdr && capability.provider === 'windows' && ['brightness', 'contrast', 'gamma'].includes(key)) failures.push(`${display.name}: unavailable while HDR is active`); else providers.add(capability.provider) }
  return failures.length > 0 ? { available: false, reason: failures.join(' · '), providers: '' } : { available: true, reason: '', providers: [...providers].join(' + ') }
}
function useTheme(theme: ProductState['settings']['theme']): void {
  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && preference.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system') preference.addEventListener('change', apply)
    return () => preference.removeEventListener('change', apply)
  }, [theme])
}
async function run<T>(request: Promise<ProductResult<T>>, setError: (error: ProductError | null) => void): Promise<T | undefined> { try { const result = await request; if (!result.ok) { setError(result.error); return undefined } return result.value } catch (error) { setError({ code: 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) }); return undefined } }
function formatValue(key: ColorKey, value: number): string { return key === 'gamma' ? value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : `${Math.round(value)}%` }
function formatName(name: string): string { return name.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()) }

const root = document.getElementById('root')
if (root === null) throw new Error('Renderer root element is missing')
createRoot(root).render(<StrictMode><ErrorBoundary><TooltipProvider><Root /></TooltipProvider></ErrorBoundary></StrictMode>)
