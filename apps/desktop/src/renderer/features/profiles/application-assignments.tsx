import { Box, Button, Flex, IconButton, Image, Menu, Portal, Stack, Text } from '@chakra-ui/react'
import { AppWindow, FolderOpen, X } from 'lucide-react'
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
      <Flex minH="26px" align="center" gap="10px">
        {editing && (
          <Flex align="center" gap="10px">
            <Button
              size="sm"
              variant="subtle"
              h="26px"
              minH="26px"
              px="10px"
              py="5px"
              rounded="6px"
              bg="bg.muted"
              color="inherit"
              fontSize="12px"
              onClick={() =>
                void run(window.chromaShift.pickApplication(), onError).then((app) => {
                  if (app !== undefined && app !== null) add(app)
                })
              }
            >
              Browse
              <FolderOpen size={16} />
            </Button>
            <Menu.Root
              positioning={{ placement: 'bottom-end' }}
              onOpenChange={(details) => {
                if (details.open) void loadApps()
              }}
            >
              <Menu.Trigger asChild>
                <Button
                  h="26px"
                  minH="26px"
                  px="10px"
                  py="5px"
                  rounded="6px"
                  bg="bg.muted"
                  color="inherit"
                  fontSize="12px"
                >
                  Select from open apps
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
                          <Stack minW="0" gap="0">
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
      <Stack mt="10px" gap="10px">
        {profile.applications.map((rule, index) => (
          <Box
            minH="47px"
            px="10px"
            py="4px"
            display="grid"
            gridTemplateColumns="30px minmax(0, 1fr) 20px"
            alignItems="center"
            gap="10px"
            rounded="6px"
            bg="bg.muted"
            key={`${rule.executableName}-${index}`}
          >
            {rule.iconDataUrl === undefined ? (
              <AppWindow size={30} />
            ) : (
              <Image
                boxSize="30px"
                rounded="full"
                objectFit="cover"
                src={rule.iconDataUrl}
                alt=""
              />
            )}
            <Stack minW="0" gap="0">
              <Text
                as="strong"
                overflow="hidden"
                fontSize="18px"
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
                fontSize="12px"
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
                p="0"
                aria-label={`Remove ${rule.executableName}`}
                onClick={() =>
                  onChange({
                    ...profile,
                    applications: profile.applications.filter((_, item) => item !== index)
                  })
                }
              >
                <X size={20} />
              </IconButton>
            )}
          </Box>
        ))}
      </Stack>
    </>
  )
}
