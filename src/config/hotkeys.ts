export type Shortcut = { key: string; mod?: boolean; shift?: boolean | 'any'; alt?: boolean; repeat?: boolean }

export const shortcuts = {
  search: [{ key: 'f', mod: true }],
  ping: [{ key: 'p', repeat: false }],
  merge: [{ key: 'm', repeat: false }],
  previous: [{ key: 'arrowleft' }],
  next: [{ key: 'arrowright' }],
  up: [{ key: 'arrowup' }],
  down: [{ key: 'arrowdown' }],
  newEntry: [{ key: 'n' }, { key: 'n', mod: true }],
  addChild: [{ key: 'enter', mod: true }],
  detach: [{ key: 'd', shift: true }],
  compare: [{ key: 'c', shift: true }],
  focus: [{ key: 'f' }, { key: 'o', mod: true }],
  fitAll: [{ key: 'a', shift: true }],
  zoomIn: [{ key: '+', shift: 'any' }, { key: '=' }],
  zoomOut: [{ key: '-' }],
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
    : binding.key === 'enter' ? 'Enter' : binding.key === 'escape' ? 'Esc' : binding.key
  return [...keys, key].join('+')
}

export function shortcutAction(event: KeyboardEvent, bindings: Record<string, Shortcut[]> = shortcuts): string | undefined {
  return Object.entries(bindings).find(([, alternatives]) => alternatives.some((binding) =>
    event.key.toLowerCase() === binding.key.toLowerCase()
    && (event.ctrlKey || event.metaKey) === !!binding.mod
    && (binding.shift === 'any' || event.shiftKey === !!binding.shift)
    && event.altKey === !!binding.alt
    && (!event.repeat || binding.repeat !== false)))?.[0]
}
