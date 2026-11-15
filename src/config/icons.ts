import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Download,
  GitBranch, GitCompareArrows, Layers3, Maximize, Moon, MoreHorizontal, Pencil, Plus,
  Radio, RotateCcw, Search, Settings, Sun, Tag, Trash2, Unlink, Upload, X,
  CircleAlert, GitBranchPlus, Group, Combine, Split, LayoutGrid, AlignCenter, Mouse, Hand,
  Scan, Network, PanelTop, PanelsTopLeft, ChevronsUp, ChevronsDown, ChevronsLeft,
  ChevronsRight, Move, ZoomIn, MousePointerClick, SquareDashedMousePointer, Scissors,
  GitMerge, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Undo2, Redo2,
} from '@lucide/vue'

export const actionIcons = {
  confirm: Check, expand: ChevronDown, previous: ChevronLeft, next: ChevronRight,
  paste: ClipboardPaste, copy: Copy, export: Download, hierarchy: GitBranch,
  compare: GitCompareArrows, layers: Layers3, focus: Maximize, darkMode: Moon,
  menu: MoreHorizontal, edit: Pencil, add: Plus, ping: Radio, reset: RotateCcw,
  search: Search, settings: Settings, lightMode: Sun, tag: Tag, delete: Trash2,
  detach: Unlink, import: Upload, close: X,
  tutorial: CircleAlert,
  addChild: GitBranchPlus, group: Group, mergeEntries: Combine, split: Split, cut: Scissors,
  mergeVersions: GitMerge, compact: LayoutGrid, center: AlignCenter, boxSelect: SquareDashedMousePointer,
  localZoom: ZoomIn, localPan: Hand, globalZoom: Mouse, globalPan: Move, focusVersion: Scan,
  neighborhood: Network, fitHeight: PanelTop, fitAll: PanelsTopLeft,
  previousVersion: ArrowLeft, nextVersion: ArrowRight, timelineUp: ArrowUp, timelineDown: ArrowDown,
  firstTimeline: ChevronsUp, lastTimeline: ChevronsDown, firstVersion: ChevronsLeft,
  lastVersion: ChevronsRight, clickPing: MousePointerClick,
  undo: Undo2, redo: Redo2,
} as const

export const actionSymbols = {
  root: '•', merge: '⋈', split: 'Y', add: '+', delete: '−', attach: '↳',
  detach: '↗', move: '↔', rename: '✎', modify: '~',
} as const
