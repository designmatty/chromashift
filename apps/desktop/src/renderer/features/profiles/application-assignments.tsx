import { Box, Button, Flex, IconButton, Image, Menu, Portal, Stack, Text } from '@chakra-ui/react'
import { AppWindow, ChevronDown, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import type { ColorProfile } from '@chromashift/core'
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
      <Flex align="center" gap={3}>
        {editing && (
          <Flex align="center" gap={3} mb={3}>
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
      <Stack gap={3}>
        {profile.applications.map((rule, index) => (
          <Box
            px="3"
            py="1"
            display="grid"
            gridTemplateColumns="30px minmax(0, 1fr) 20px"
            alignItems="center"
            gap={3}
            rounded="md"
            bg="bg.subtle"
            key={`${rule.executableName}-${index}`}
          >
            {rule.iconDataUrl === undefined ? (
              <AppWindow />
            ) : (
              <Image
                boxSize="30px"
                rounded="full"
                objectFit="cover"
                src={rule.iconDataUrl}
                alt={`${rule.executableName}`}
              />
            )}
            <Stack gap="0">
              <Text
                as="strong"
                overflow="hidden"
                fontSize="md"
                fontWeight="500"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {rule.executableName}
              </Text>
              <Text
                as="small"
                overflow="hidden"
                fontFamily="mono"
                fontSize="xs"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {rule.executablePath ?? 'Filename match'}
              </Text>
            </Stack>
            {editing && (
              <IconButton
                variant="ghost"
                boxSize="20px"
                minW="20px"
                aria-label={`Remove ${rule.executableName}`}
                onClick={() =>
                  onChange({
                    ...profile,
                    applications: profile.applications.filter((_, item) => item !== index)
                  })
                }
              >
                <X />
              </IconButton>
            )}
          </Box>
        ))}
      </Stack>
    </>
  )
}
