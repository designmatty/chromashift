import { Button, Dialog, Portal, Text } from '@chakra-ui/react'
import { useRef } from 'react'

export function ProfileActionDialog(props: {
  open: boolean
  title: string
  description: string
  busy: boolean
  primaryLabel: string
  danger?: boolean
  onPrimary(): void
  onDiscard?: () => void
  onCancel(): void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog.Root
      open={props.open}
      role="alertdialog"
      placement="center"
      size="sm"
      closeOnEscape={!props.busy}
      closeOnInteractOutside={!props.busy}
      initialFocusEl={() => cancelRef.current}
      finalFocusEl={() =>
        document.querySelector(
          '[data-part="profile-item"][data-selected] [data-part="profile-select"]'
        ) ??
        document.querySelector('[data-part="settings-nav"] [aria-current="page"]') ??
        document.querySelector('[aria-label="App view"]')
      }
      onOpenChange={({ open }) => {
        if (!open && !props.busy) props.onCancel()
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg={{ base: 'bg.panel', _dark: 'bg.muted' }} shadow="sm">
            <Dialog.Header>
              <Dialog.Title>{props.title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description asChild>
                <Text color="fg.muted">{props.description}</Text>
              </Dialog.Description>
            </Dialog.Body>
            <Dialog.Footer flexWrap="wrap">
              <Button
                ref={cancelRef}
                variant="outline"
                disabled={props.busy}
                onClick={props.onCancel}
              >
                Cancel
              </Button>
              {props.onDiscard && (
                <Button variant="outline" disabled={props.busy} onClick={props.onDiscard}>
                  Discard changes
                </Button>
              )}
              <Button
                colorPalette={props.danger ? 'red' : undefined}
                loading={props.busy}
                onClick={props.onPrimary}
              >
                {props.primaryLabel}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
