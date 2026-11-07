import { Box, Button, Input, Text } from '@chakra-ui/react'
import { useRef, useState } from 'react'
import { useWheelAdjustment } from '@/hooks/use-wheel-adjustment'
import {
  formatValue,
  createControlValueEdit,
  hueToDegrees,
  parseControlValue,
  type ColorControlKey
} from '@/features/profiles/control-values'

export function ControlValue({
  control,
  value,
  min,
  max,
  step,
  label,
  disabled,
  pointerOnly = false,
  onChange
}: {
  control: ColorControlKey
  value: number
  min: number
  max: number
  step: number
  label: string
  disabled: boolean
  pointerOnly?: boolean
  onChange(value: number): void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const finished = useRef(false)
  const edit = useRef<ReturnType<typeof createControlValueEdit> | null>(null)
  const normalize = (next: number): number => Number(Math.min(max, Math.max(min, next)).toFixed(2))
  const adjust = (direction: number): void => {
    const current = editing ? (parseControlValue(control, text, min, max) ?? value) : value
    const next = normalize(current + direction * step)
    if (editing) setText(String(control === 'hue' ? hueToDegrees(next) : next))
    else onChange(next)
  }
  // The wheel only adjusts an open editor, so scrolling past a value never changes it.
  const ref = useWheelAdjustment<HTMLDivElement>(editing && !disabled, adjust)
  function finish(save: boolean): void {
    if (finished.current) return
    finished.current = true
    const next = edit.current?.finish(text, save)
    if (next !== undefined) onChange(next)
    setEditing(false)
  }
  return (
    <Box
      ref={ref}
      ml="auto"
      flex="none"
      width="76px"
      fontFamily="mono"
      fontVariantNumeric="tabular-nums"
    >
      {pointerOnly ? (
        <Text
          data-part="color-value"
          aria-label={label}
          textAlign="right"
          fontSize="xs"
          color={disabled ? 'fg.muted' : undefined}
        >
          {formatValue(control, value)}
        </Text>
      ) : editing && !disabled ? (
        <Input
          autoFocus
          size="xs"
          inputMode="decimal"
          aria-label={label}
          value={text}
          textAlign="right"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Enter') {
              event.preventDefault()
              finish(event.key === 'Enter')
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const current = parseControlValue(control, text, min, max) ?? value
              const next = normalize(current + (event.key === 'ArrowUp' ? step : -step))
              setText(String(control === 'hue' ? hueToDegrees(next) : next))
            }
          }}
        />
      ) : (
        <Button
          data-part="color-value"
          variant="plain"
          size="xs"
          width="full"
          justifyContent="flex-end"
          fontFamily="inherit"
          px="0"
          disabled={disabled}
          aria-label={label}
          onClick={() => {
            finished.current = false
            edit.current = createControlValueEdit(control, value, min, max)
            setText(edit.current.text)
            setEditing(true)
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) {
              event.preventDefault()
              adjust(event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1)
            }
          }}
        >
          {formatValue(control, value)}
        </Button>
      )}
    </Box>
  )
}
