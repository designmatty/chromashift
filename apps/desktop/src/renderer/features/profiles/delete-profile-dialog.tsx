import { Button, Dialog, Portal, Text } from '@chakra-ui/react'
import { useRef } from 'react'
import type { ColorProfile } from '@chromashift/core'

export interface DeleteProfileDialogProps {
  profile: ColorProfile | null
  busy: boolean
  onCancel(): void
  onConfirm(): void
}

export function DeleteProfileDialog(props: DeleteProfileDialogProps): React.JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog.Root
      open={props.profile !== null}
      role="alertdialog"
      placement="center"
      size="sm"
      closeOnEscape={!props.busy}
      closeOnInteractOutside={!props.busy}
      initialFocusEl={() => cancelButtonRef.current}
      finalFocusEl={() =>
        document.querySelector(
          '[data-part="profile-item"][data-selected] [data-part="profile-select"]'
        )
      }
      onOpenChange={(details) => {
        if (!details.open && !props.busy) props.onCancel()
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg={{ base: 'bg.panel', _dark: 'bg.muted' }} shadow={'sm'}>
            <Dialog.Header>
              <Dialog.Title>Delete profile?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description asChild>
                <Text color="fg.muted">
                  “{props.profile?.name}” will be permanently deleted. This cannot be undone.
                </Text>
              </Dialog.Description>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                ref={cancelButtonRef}
                variant="outline"
                disabled={props.busy}
                onClick={props.onCancel}
              >
                Cancel
              </Button>
              <Button colorPalette="red" loading={props.busy} onClick={props.onConfirm}>
                Delete profile
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
