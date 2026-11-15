import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Download,
  GitBranch, GitCompareArrows, Layers3, Maximize, Moon, MoreHorizontal, Pencil, Plus,
  Radio, RotateCcw, Search, Settings, Sun, Tag, Trash2, Unlink, Upload, X,
  CircleAlert,
} from '@lucide/vue'

export const actionIcons = {
  confirm: Check, expand: ChevronDown, previous: ChevronLeft, next: ChevronRight,
  paste: ClipboardPaste, copy: Copy, export: Download, hierarchy: GitBranch,
  compare: GitCompareArrows, layers: Layers3, focus: Maximize, darkMode: Moon,
  menu: MoreHorizontal, edit: Pencil, add: Plus, ping: Radio, reset: RotateCcw,
  search: Search, settings: Settings, lightMode: Sun, tag: Tag, delete: Trash2,
  detach: Unlink, import: Upload, close: X,
  tutorial: CircleAlert,
} as const

export const actionSymbols = {
  root: '•', merge: '⋈', split: 'Y', add: '+', delete: '−', attach: '↳',
  detach: '↗', move: '↔', rename: '✎', modify: '~',
} as const
