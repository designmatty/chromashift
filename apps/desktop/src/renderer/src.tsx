import { Fragment, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { NativeStatus } from '../preload/index.js'
import './styles.css'

declare global {
  interface Window {
    chromaShift: {
      getNativeStatus(): Promise<NativeStatus>
    }
  }
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<NativeStatus>({ state: 'starting' })

  useEffect(() => {
    if (window.chromaShift === undefined) {
      setStatus({
        state: 'error',
        message: 'Desktop bridge unavailable. The preload script failed to load.'
      })
      return
    }

    void window.chromaShift.getNativeStatus().then(setStatus).catch((error: unknown) => {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }, [])

  return (
    <main>
      <p className="eyebrow">Phase 0 diagnostics</p>
      <h1>ChromaShift</h1>
      <section>
        <h2>Native service</h2>
        {status.state === 'starting' && <p>Starting DisplayService…</p>}
        {status.state === 'error' && <p className="error">{status.message}</p>}
        {status.state === 'ready' && (
          <>
            <dl>
              <dt>Status</dt><dd className="success">Ready</dd>
              <dt>Protocol</dt><dd>{status.info.protocolVersion}</dd>
              <dt>Service</dt><dd>{status.info.serviceVersion}</dd>
              <dt>Process ID</dt><dd>{status.info.processId}</dd>
              <dt>Operating system</dt><dd>{status.info.operatingSystem}</dd>
              <dt>AMD ADLX</dt><dd>{status.info.providers.amd.initialized ? `Ready (${status.info.providers.amd.version ?? 'unknown version'})` : status.info.providers.amd.error ?? 'Unavailable'}</dd>
              <dt>AMD displays</dt><dd>{status.info.providers.amd.displayCount} — {status.info.providers.amd.runtimeValidation}</dd>
            </dl>
            <h3>Foreground application</h3>
            {status.currentApplication === null ? (
              <p>No foreground window was available.</p>
            ) : (
              <dl>
                <dt>Executable</dt><dd>{status.currentApplication.executable ?? 'Unavailable'}</dd>
                <dt>Path</dt><dd>{status.currentApplication.path ?? 'Unavailable'}</dd>
                <dt>Title</dt><dd>{status.currentApplication.title || 'Untitled'}</dd>
                <dt>Monitor</dt><dd>{status.currentApplication.monitorDeviceName ?? 'Unavailable'}</dd>
              </dl>
            )}
            <h3>Last hook event</h3>
            <p>{status.lastForegroundEvent?.executable ?? 'Waiting for a focus change…'}</p>
            <h3>Displays</h3>
            {status.displays.map((display) => (
              <article key={display.id}>
                <h4>{display.name}{display.primary ? ' — Primary' : ''}</h4>
                <dl>
                  <dt>Stable ID</dt><dd>{display.id}</dd>
                  <dt>Windows source</dt><dd>{display.windowsDisplayName}</dd>
                  <dt>Adapter</dt><dd>{display.adapter.name} ({display.adapter.vendor})</dd>
                  <dt>Connection</dt><dd>{display.connection}</dd>
                  <dt>HDR</dt><dd>{display.hdr ? 'On' : 'Off'}</dd>
                  <dt>Advanced color</dt><dd>{display.advancedColorSupported ? 'Supported' : 'Unsupported'}</dd>
                  <dt>Refresh rate</dt><dd>{display.refreshRate} Hz</dd>
                  <dt>Serial</dt><dd>{display.serialNumber ?? 'Unavailable'}</dd>
                </dl>
                <h5>Capabilities</h5>
                <dl>
                  {Object.entries(status.capabilityReports[display.id]?.capabilities ?? {}).map(([name, capability]) => (
                    <Fragment key={name}>
                      <dt>{formatCapabilityName(name)}</dt>
                      <dd>{capability.supported ? `${capability.provider}${capability.min != null && capability.max != null ? ` (${capability.min}–${capability.max})` : ''}` : `Unsupported — ${capability.reason ?? 'no provider'}`}</dd>
                    </Fragment>
                  ))}
                </dl>
                {display.adapter.vendor === 'nvidia' && (
                  <p className="native-state">
                    Native NVIDIA: saturation {status.capabilityReports[display.id]?.nativeState.nvidia.saturation.current ?? 'unavailable'}, hue {status.capabilityReports[display.id]?.nativeState.nvidia.hue.current ?? 'unavailable'}
                  </p>
                )}
              </article>
            ))}
          </>
        )}
      </section>
      <p className="note">This screen intentionally exposes diagnostics only. Display controls arrive after the lifecycle and restoration paths are proven.</p>
    </main>
  )
}

function formatCapabilityName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

const root = document.getElementById('root')
if (root === null) throw new Error('Renderer root element is missing')
createRoot(root).render(<StrictMode><App /></StrictMode>)
