import { Badge, Box, Button, Flex, Grid, Heading, Stack, Text } from '@chakra-ui/react'
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
    <Box as="section" h="full" minH="full" p="20px" overflow="hidden" rounded="16px" bg="bg.panel">
      <Flex as="header" minH="26px" mb="17px" align="center" justify="space-between" gap="16px">
        <Heading as="h1" fontSize="18px" fontWeight="700" lineHeight="23px">
          Displays
        </Heading>
        <Button
          variant="subtle"
          size="sm"
          h="26px"
          minH="26px"
          px="10px"
          py="5px"
          rounded="26px"
          bg="bg.muted"
          color="inherit"
          fontSize="12px"
          onClick={() => void run(window.chromaShift.restoreBaseline(), onError)}
        >
          <RefreshCcwDot size={16} />
          Restore original display settings
        </Button>
      </Flex>
      <Stack gap="10px">
        {product.displays.map((display) => (
          <Box as="article" minW="0" key={display.id}>
            <Flex minH="57px" p="10px" align="center" gap="10px" rounded="6px" bg="bg.muted">
              <Box minW="0" flex="1">
                <Heading
                  as="h2"
                  overflow="hidden"
                  fontSize="18px"
                  fontWeight="500"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {display.name}
                </Heading>
                <Text
                  overflow="hidden"
                  fontFamily="mono"
                  fontSize="14px"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {display.adapter.name} · {display.connection} · {display.refreshRate} Hz
                </Text>
              </Box>
              {display.primary && (
                <Badge
                  h="20px"
                  px="6px"
                  py="2px"
                  rounded="6px"
                  bg="badge.primaryBg"
                  color="badge.primaryFg"
                  fontSize="12px"
                  fontWeight="500"
                >
                  Primary
                </Badge>
              )}
            </Flex>
            <Grid p="10px" templateColumns="repeat(2, minmax(0, 1fr))" gap="12px 10px">
              {Object.entries(product.capabilityReports[display.id]?.capabilities ?? {}).map(
                ([name, capability]) => (
                  <Flex
                    minW="0"
                    h="21px"
                    align="center"
                    gap="10px"
                    color={capability.supported ? 'fg' : 'fg.muted'}
                    key={name}
                  >
                    <Text
                      minW="0"
                      flex="1"
                      overflow="hidden"
                      fontSize="16px"
                      fontWeight="500"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {formatName(name)}
                    </Text>
                    <Text as="strong" fontFamily="mono" fontSize="12px" fontWeight="400">
                      {capability.supported ? capability.provider.toLowerCase() : 'unavailable'}
                    </Text>
                  </Flex>
                )
              )}
            </Grid>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
