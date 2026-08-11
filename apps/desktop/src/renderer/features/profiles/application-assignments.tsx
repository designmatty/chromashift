import { Button, Menu, Portal } from '@chakra-ui/react'
import { AppWindow, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { SectionTitle } from '@/components/layout/presentational'
import { run } from '@/lib/product-result'
import type { ApplicationSelection, ProductError } from '../../../shared/product-api.js'

export function ApplicationAssignments({
  profile,
  editing,
  onChange,
  onError
}: {
  profile: ColorProfile
  editing: boolean
  onChange(profile: ColorProfile): void
  onError(error: ProductError | null): void
}): React.JSX.Element {
  const [apps, setApps] = useState<ApplicationSelection[]>([])

  async function loadApps(): Promise<void> {
    const result = await run(window.chromaShift.listApplications(), onError)
    if (result !== undefined) setApps(result)
  }

  function add(app: ApplicationSelection): void {
    if (
      profile.applications.some(
        (rule) => rule.executablePath?.toLowerCase() === app.executablePath.toLowerCase()
      )
    ) {
      return
    }
    onChange({
      ...profile,
      applications: [
        ...profile.applications,
        { executableName: app.executableName, executablePath: app.executablePath }
      ]
    })
  }

  return (
    <>
      <div className="application-heading">
        <SectionTitle
          title="Applications"
          description="Choose a visible application or browse for an executable."
        />
        {editing && (
          <div className="application-actions">
            <Menu.Root
              positioning={{ placement: 'bottom-end' }}
              onOpenChange={(details) => {
                if (details.open) void loadApps()
              }}
            >
              <Menu.Trigger asChild>
                <Button colorPalette="brand" size="sm" variant="outline">
                  <AppWindow />
                  Open application
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="260px">
                    {apps.length === 0 ? (
                      <Menu.Item disabled value="empty">
                        No visible applications
                      </Menu.Item>
                    ) : (
                      apps.map((app) => (
                        <Menu.Item
                          data-slot="dropdown-menu-item"
                          key={app.executablePath}
                          value={app.executablePath}
                          onSelect={() => add(app)}
                        >
                          {app.iconDataUrl !== null ? <img src={app.iconDataUrl} /> : <AppWindow />}
                          <span>
                            <strong>{app.friendlyName}</strong>
                            <small>{app.executableName}</small>
                          </span>
                        </Menu.Item>
                      ))
                    )}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
            <Button
              colorPalette="brand"
              size="sm"
              variant="outline"
              onClick={() =>
                void run(window.chromaShift.pickApplication(), onError).then((app) => {
                  if (app !== undefined && app !== null) add(app)
                })
              }
            >
              <FolderOpen />
              Browse
            </Button>
          </div>
        )}
      </div>
      <div className="assigned-apps">
        {profile.applications.length === 0 && <p>No applications assigned.</p>}
        {profile.applications.map((rule, index) => (
          <div className="assigned-app" key={`${rule.executableName}-${index}`}>
            <AppWindow />
            <span>
              <strong>{rule.executableName}</strong>
              <small>{rule.executablePath ?? 'Filename match'}</small>
            </span>
            {editing && (
              <button
                aria-label={`Remove ${rule.executableName}`}
                onClick={() =>
                  onChange({
                    ...profile,
                    applications: profile.applications.filter((_, item) => item !== index)
                  })
                }
              >
                <X />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
