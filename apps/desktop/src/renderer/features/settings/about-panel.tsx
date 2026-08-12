import { Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react'
import { Brand } from '@/components/layout/presentational'

export function AboutPanel({ version }: { version: string }): React.JSX.Element {
  return (
    <Box as="section" h="full" minH="full" p="20px" overflow="hidden" rounded="16px" bg="bg.panel">
      <Flex h="58px" align="center" justify="center">
        <Box css={{ '& > div': { width: '199px', height: '31px' } }}>
          <Brand />
        </Box>
      </Flex>
      <Flex minH="57px" p="10px" align="center" gap="20px" bg="bg.muted">
        <Stack minW="0" flex="1" gap="0">
          <Heading as="h1" fontSize="18px" fontWeight="700" lineHeight="23px">
            Version {version}
          </Heading>
          <Text fontFamily="mono" fontSize="14px">
            Last checked on August 11, 2026
          </Text>
        </Stack>
        <Button
          h="26px"
          minH="26px"
          px="10px"
          py="5px"
          rounded="26px"
          bg="#0f0f12"
          color="white"
          fontSize="12px"
          onClick={() => undefined}
        >
          Check for updates
        </Button>
      </Flex>
    </Box>
  )
}
