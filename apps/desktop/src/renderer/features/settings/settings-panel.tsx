import { Button, NativeSelect, Separator } from '@chakra-ui/react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { SettingsRow } from '@/components/layout/presentational'
import { Switch } from '@/components/ui/switch'
import { run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

export function SettingsPanel({
  product,
  onError
}: {
  product: ProductState
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const settings = product.settings
  const update = (next: typeof settings): void => {
    void run(window.chromaShift.updateSettings(next), onError)
  }

  return (
    <section className="settings-page">
      <header>
        <h1>Settings</h1>
        <p>Control how ChromaShift starts, closes, and appears.</p>
      </header>
      <SettingsRow
        title="Launch at startup"
        description="Start ChromaShift when you sign in to Windows."
      >
        <Switch
          checked={settings.launchAtStartup}
          onCheckedChange={(value) => update({ ...settings, launchAtStartup: value })}
        />
      </SettingsRow>
      <SettingsRow
        title="Windows startup behavior"
        description="Choose what appears during an automatic login launch."
      >
        <NativeSelect.Root size="sm" width="190px">
          <NativeSelect.Field
            aria-label="Windows startup behavior"
            value={settings.launchBehavior}
            onChange={(event) =>
              update({ ...settings, launchBehavior: event.target.value as 'tray' | 'app' })
            }
          >
            <option value="tray">Start in tray</option>
            <option value="app">Show app panel</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </SettingsRow>
      <SettingsRow title="Close behavior" description="Choose what the window close button does.">
        <NativeSelect.Root size="sm" width="190px">
          <NativeSelect.Field
            aria-label="Close behavior"
            value={settings.closeBehavior}
            onChange={(event) =>
              update({
                ...settings,
                closeBehavior: event.target.value as 'tray' | 'shutdown'
              })
            }
          >
            <option value="tray">Minimize to tray</option>
            <option value="shutdown">Shut down ChromaShift</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </SettingsRow>
      <SettingsRow title="Theme" description="Use the Windows theme or choose one explicitly.">
        <NativeSelect.Root size="sm" width="190px">
          <NativeSelect.Field
            aria-label="Theme"
            value={settings.theme}
            onChange={(event) =>
              update({
                ...settings,
                theme: event.target.value as 'system' | 'light' | 'dark'
              })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </SettingsRow>
      <Separator />
      <div className="settings-actions">
        <Button
          colorPalette="brand"
          variant="outline"
          onClick={() => void run(window.chromaShift.restoreBaseline(), onError)}
        >
          <RotateCcw />
          Restore original display settings
        </Button>
        <Button colorPalette="brand" variant="outline" disabled>
          <FolderOpen />
          Open logs and diagnostics
        </Button>
        <small>Log-file browsing will be connected with Milestone 5 diagnostics.</small>
      </div>
    </section>
  )
}
