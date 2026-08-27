import { Badge, Box, Button, Flex, Heading, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { RefreshCcwDot } from 'lucide-react'
import { formatName, run } from '@/lib/product-result'
import type { ProductError, ProductState } from '../../../shared/product-api.js'

export function DisplaysView({
  product,
  onError
}: {
  product: ProductState
  onError(error: ProductError | null): void
}): React.JSX.Element {
  return (
    <Stack as="section" h="full" gap="4">
      <Flex as="header" align="center" justify="space-between">
        <Heading as="h1" size="lg">
          Displays
        </Heading>
        <Button
          variant="outline"
          size={'xs'}
          borderRadius={'full'}
          onClick={() => void run(window.chromaShift.restoreBaseline(), onError)}
        >
          <RefreshCcwDot />
          Restore original display settings
        </Button>
      </Flex>
      {product.displays.map((display) => (
        <Box key={display.id}>
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
            <Box flex="1">
              <Heading
                as="h2"
                size={'md'}
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {display.name}
              </Heading>
              <Text
                overflow="hidden"
                fontFamily="mono"
                fontSize="sm"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {display.adapter.name} · {display.connection} · {display.refreshRate} Hz
              </Text>
            </Box>
            {display.primary && (
              <Badge size={'lg'} colorPalette={'blue'}>
                Primary
              </Badge>
            )}
          </Flex>
          <SimpleGrid p="2" columns={2} columnGap={6} rowGap={3}>
            {Object.entries(product.capabilityReports[display.id]?.capabilities ?? {})
              .filter(([name]) => name !== 'colorTemperature' || display.adapter.vendor === 'amd')
              .map(([name, capability]) => (
                <Flex
                  align="center"
                  gap="3"
                  color={capability.supported ? 'fg' : 'fg.muted'}
                  key={name}
                >
                  <Text
                    flex="1"
                    overflow="hidden"
                    fontSize="md"
                    fontWeight="500"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                  >
                    {formatName(name)}
                  </Text>
                  <Text as="strong" fontFamily="mono" fontSize="xs" fontWeight="400">
                    {capability.supported ? capability.provider.toLowerCase() : 'unavailable'}
                  </Text>
                </Flex>
              ))}
          </SimpleGrid>
        </Box>
      ))}
    </Stack>
  )
}
