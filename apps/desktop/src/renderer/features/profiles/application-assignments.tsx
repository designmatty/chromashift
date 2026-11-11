import { Button, Flex, Icon, IconButton, Image, Menu, Portal, Stack, Text } from '@chakra-ui/react'
import { AppWindow, ChevronDown, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
import { run } from '@/lib/product-result'
import { Tooltip } from '@/components/ui/tooltip'
import type { ApplicationSelection, ProductError } from '@shared/product-api.js'

export function ApplicationAssignments({
  profile,
  editing,
  children,
  onChange,
  onError
}: {
  profile: ColorProfile
  editing: boolean
  children: React.ReactNode
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
        {
          executableName: app.executableName,
          executablePath: app.executablePath,
          ...(app.iconDataUrl === null ? {} : { iconDataUrl: app.iconDataUrl })
        }
      ]
    })
  }

  return (
    <>
      <Flex data-part="trigger-heading" align="center" gap="4" mb="3">
        <Flex flex="1" minW="0" direction="column">
          {children}
        </Flex>
        {editing && (
          <Flex data-part="trigger-actions" align="center" gap="3" flexShrink="0" ml="auto">
            <Button
              size="2xs"
              variant="subtle"
              bg={{ base: 'bg.muted', _dark: 'bg.emphasized' }}
              color="inherit"
              onClick={() =>
                void run(window.chromaShift.pickApplication(), onError).then((app) => {
                  if (app !== undefined && app !== null) add(app)
                })
              }
            >
              Browse
              <FolderOpen />
            </Button>
            <Menu.Root
              positioning={{ placement: 'bottom-end' }}
              onOpenChange={(details) => {
                if (details.open) void loadApps()
              }}
            >
              <Menu.Trigger asChild>
                <Button
                  size="2xs"
                  variant="subtle"
                  bg={{ base: 'bg.muted', _dark: 'bg.emphasized' }}
                  color="inherit"
                >
                  Select from open apps
                  <ChevronDown />
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="260px">
                    {apps.length === 0 ? (
                      <Menu.Item disabled value="empty">
                        No open apps available for triggers
                      </Menu.Item>
                    ) : (
                      apps.map((app) => (
                        <Menu.Item
                          data-slot="dropdown-menu-item"
                          key={app.executablePath}
                          value={app.executablePath}
                          onSelect={() => add(app)}
                        >
                          {app.iconDataUrl !== null ? (
                            <Image boxSize="20px" rounded="full" src={app.iconDataUrl} alt="" />
                          ) : (
                            <AppWindow />
                          )}
                          <Stack gap="0">
                            <Text as="strong">{app.friendlyName}</Text>
                            <Text as="small">{app.executableName}</Text>
                          </Stack>
                        </Menu.Item>
                      ))
                    )}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          </Flex>
        )}
      </Flex>
      <Flex data-part="trigger-chips" gap="2" wrap="wrap">
        {profile.applications.map((rule, index) => (
          <Flex
            data-part="trigger-chip"
            px="2"
            py="1"
            align="center"
            gap="1.5"
            minW="0"
            maxW="full"
            rounded="md"
            bg="bg.subtle"
            key={`${rule.executableName}-${index}`}
          >
            {rule.iconDataUrl === undefined ? (
              <Icon boxSize="4" flexShrink="0">
                <AppWindow />
              </Icon>
            ) : (
              <Image
                boxSize="4"
                flexShrink="0"
                rounded="full"
                objectFit="cover"
                src={rule.iconDataUrl}
                alt=""
              />
            )}
            <Text minW="0" fontSize="sm" fontWeight="500" truncate>
              {rule.executableName}
            </Text>
            {editing && (
              <Tooltip content={`Remove ${rule.executableName}`}>
                <IconButton
                  variant="ghost"
                  boxSize="20px"
                  minW="20px"
                  flexShrink="0"
                  aria-label={`Remove ${rule.executableName}`}
                  onClick={() =>
                    onChange({
                      ...profile,
                      applications: profile.applications.filter((_, item) => item !== index)
                    })
                  }
                >
                  <X size={14} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
        ))}
      </Flex>
    </>
  )
}
