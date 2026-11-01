import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Switch } from './switch'
import { haptic as triggerHaptic } from '../host-helpers'
// tier art) still lay out on these exact columns so their controls line up.
export const LIST_ROW_COLUMNS = '@2xl:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)]'

// The one settings row. `action` is the row's control: beside the label on a
// wide pane, under the description on a narrow one — the row owns that
// alignment, so callers never wrap a control in `justify-end`/`items-end`.
// `wide` rows (galleries, editors) keep the control on the title line and give
// the full width to `below`.
export function ListRow({
  title,
  description,
  hint,
  action,
  below,
  'data-tour': dataTour,
  id,
  wide = false,
  className
}: {
  title: ReactNode
  description?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  below?: ReactNode
  /** Durable handle for tours (see lib/tour) — usually the field's schema key. */
  'data-tour'?: string
  id?: string
  wide?: boolean
  className?: string
}) {
  return (
    // Container-queried, not viewport-queried: the label/control split keys on
    // the row's own pane width, so a narrow detail column (messaging, split
    // views) stacks instead of squishing the label against minmax(15rem,…).
    <div className={cn('@container', className)} data-tour={dataTour} id={id}>
      <div className={cn('grid gap-3 py-3', !wide && [LIST_ROW_COLUMNS, '@2xl:items-center'])}>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
            <span className="min-w-0">{title}</span>
            {wide && action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </div>
          {description && (
            <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
              {description}
            </div>
          )}
          {hint && <div className="mt-1 block font-mono text-[0.68rem] text-muted-foreground/45">{hint}</div>}
          {below}
        </div>
        {!wide && action && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 @2xl:justify-self-end @2xl:justify-end">
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

// The one boolean row: every on/off setting is a Switch in a ListRow (haptic
// baked in). Never a two-option SegmentedControl — that is for choices.
export function ToggleRow({
  checked,
  below,
  'data-tour': dataTour,
  description,
  disabled,
  hint,
  id,
  label,
  onChange,
  wide
}: {
  checked: boolean
  below?: ReactNode
  'data-tour'?: string
  description?: ReactNode
  disabled?: boolean
  hint?: ReactNode
  id?: string
  label: string
  onChange: (on: boolean) => void
  wide?: boolean
}) {
  return (
    <ListRow
      action={
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={on => {
            triggerHaptic('selection')
            onChange(on)
          }}
        />
      }
      below={below}
      data-tour={dataTour}
      description={description}
      hint={hint}
      id={id}
      title={label}
      wide={wide}
    />
  )
}
