import { Button, Flex, Heading, Stack, Text } from '@chakra-ui/react'
import { Brand } from '@/components/layout/presentational'

export function AboutPanel({ version }: { version: string }): React.JSX.Element {
  return (
    <Stack as="section" h="full" minH="full" gap="4">
      <Flex padding={8} align="center" justify="center" css={{ '& > img': { height: '35px' } }}>
        <Brand />
      </Flex>
      <Flex
        minH="58px"
        borderRadius={'lg'}
        px="4"
        py="2"
        align="center"
        justify="space-between"
        gap="5"
        borderWidth="1px"
        borderColor={{ base: 'border', _dark: 'border.muted' }}
        bg={'bg.subtle'}
      >
        <Stack flex="1" gap="0">
          <Heading as="h2" size="md">
            Version {version}
          </Heading>
          <Text fontFamily="mono" fontSize="sm">
            Last checked on August 11, 2026
          </Text>
        </Stack>
        <Button size={'xs'} borderRadius={'full'} onClick={() => undefined}>
          Check for updates
        </Button>
      </Flex>
    </Stack>
  )
}
