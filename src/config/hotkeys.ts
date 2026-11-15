export type Shortcut = { key: string; mod?: boolean; shift?: boolean | 'any'; alt?: boolean; repeat?: boolean }

export const shortcuts = {
  search: [{ key: 'f', mod: true }],
  undo: [{ key: 'z', mod: true, repeat: false }],
  redo: [{ key: 'y', mod: true, repeat: false }],
  ping: [],
  merge: [{ key: 'm', shift: true, repeat: false }],
  previous: [{ key: 'arrowleft' }],
  next: [{ key: 'arrowright' }],
  up: [{ key: 'arrowup' }],
  down: [{ key: 'arrowdown' }],
  newEntry: [{ key: 'n' }],
  deleteNode: [{ key: 'delete' }],
  addChild: [{ key: 'a' }],
  group: [{ key: 'g' }],
  edit: [{ key: 'e' }],
  detach: [{ key: 'd' }],
  tag: [{ key: 't' }],
  mergeEntries: [{ key: 'm' }],
  split: [{ key: 's' }],
  compare: [{ key: 'c', shift: true }],
  compact: [{ key: 'l', shift: true }],
  center: [{ key: 'a', shift: true }],
  focus: [{ key: '1' }],
  neighborhood: [{ key: '2' }],
  fitHeight: [{ key: '3' }],
  fitAll: [{ key: '4' }],
  firstLane: [{ key: 'pageup' }],
  lastLane: [{ key: 'pagedown' }],
  firstVersion: [{ key: 'home' }],
  lastVersion: [{ key: 'end' }],
  selectAll: [{ key: 'a', mod: true }],
  copy: [{ key: 'c', mod: true }],
  cut: [{ key: 'x', mod: true }],
  paste: [{ key: 'v', mod: true }],
  dismiss: [{ key: 'escape' }],
} satisfies Record<string, Shortcut[]>

export type ShortcutAction = keyof typeof shortcuts

export function shortcutLabel(action: ShortcutAction, accessible = false): string {
  const binding: Shortcut | undefined = shortcuts[action][0]
  if (!binding) return ''
  const keys = [binding.mod ? (accessible ? 'Ctrl or Command' : 'Ctrl/⌘') : '',
    binding.shift === true ? 'Shift' : '', binding.alt ? 'Alt' : ''].filter(Boolean)
  const key = binding.key.length === 1 ? binding.key.toUpperCase()
    : ({ enter: 'Enter', escape: 'Esc', delete: 'Delete', pageup: 'Page Up', pagedown: 'Page Down',
      home: 'Home', end: 'End', arrowleft: 'Left Arrow', arrowright: 'Right Arrow',
      arrowup: 'Up Arrow', arrowdown: 'Down Arrow' } as Record<string, string>)[binding.key] ?? binding.key
  return [...keys, key].join('+')
}

export function shortcutAction(event: KeyboardEvent): ShortcutAction | undefined
export function shortcutAction(event: KeyboardEvent, bindings: Record<string, Shortcut[]>): string | undefined
export function shortcutAction(event: KeyboardEvent, bindings: Record<string, Shortcut[]> = shortcuts): string | undefined {
  return Object.entries(bindings).find(([, alternatives]) => alternatives.some((binding) =>
    event.key.toLowerCase() === binding.key.toLowerCase()
    && (event.ctrlKey || event.metaKey) === !!binding.mod
    && (binding.shift === 'any' || event.shiftKey === !!binding.shift)
    && event.altKey === !!binding.alt
    && (!event.repeat || binding.repeat !== false)))?.[0]
}
