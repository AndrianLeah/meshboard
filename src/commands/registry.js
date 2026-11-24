// Every action of the board page, by id: buttons, menu rows and keys all run commands from here.
// A command is { id, label, icon?, run(), enabled?(), checked?() }.
import { matchEvent, shortcutFor } from './keymap.js'
import { SHAPES } from '../core/schema.js'

const TOOL_LABELS = {
  select: ['Select', 'select'],
  hand: ['Hand', 'hand'],
  note: ['Sticky note', 'note'],
  text: ['Text', 'text'],
  rect: ['Rectangle', 'rect'],
  ellipse: ['Oval', 'ellipse'],
  triangle: ['Triangle', 'triangle'],
  diamond: ['Diamond', 'diamond'],
  connector: ['Connection line', 'connector'],
  pen: ['Pen', 'pen'],
  eraser: ['Eraser', 'eraser'],
  frame: ['Frame', 'frame'],
}

/**
 * app: { board, store, ui } where `ui` has the page-level actions: openShapes, openReactionPicker,
 * openShortcuts, copy, cut, paste, share, exportBoard, importBoard, rename, install, canInstall,
 * goHome.
 */
export function createCommands({ board, store, ui }) {
  const sel = () => board.selection()
  const some = () => sel().length > 0
  const unlocked = () => sel().some((it) => !it.locked)
  const singleNote = () => {
    const s = sel()
    return s.length === 1 && s[0].type === 'note' ? s[0] : null
  }

  const list = [
    ...Object.entries(TOOL_LABELS).map(([tool, [label, icon]]) => ({
      id: `tool.${tool}`,
      label,
      icon,
      run: () => board.setTool(tool),
      checked: () => board.tool === tool,
    })),
    {
      id: 'tool.shapes',
      label: 'Shapes',
      icon: 'shapes',
      run: () => ui.openShapes(),
      checked: () => SHAPES.includes(board.tool),
    },

    { id: 'undo', label: 'Undo', icon: 'undo', run: () => store.undo(), enabled: () => store.canUndo() },
    { id: 'redo', label: 'Redo', icon: 'redo', run: () => store.redo(), enabled: () => store.canRedo() },
    { id: 'copy', label: 'Copy', run: () => ui.copy(), enabled: some },
    { id: 'cut', label: 'Cut', run: () => ui.cut(), enabled: unlocked },
    { id: 'paste', label: 'Paste', run: () => ui.paste() },
    { id: 'duplicate', label: 'Duplicate', icon: 'duplicate', run: () => board.duplicateSelection(), enabled: some },
    { id: 'select-all', label: 'Select all', run: () => board.selectAll() },
    { id: 'edit', label: 'Edit text', run: () => board.editSelection(), enabled: () => sel().length === 1 },
    {
      id: 'escape',
      label: 'Deselect',
      run() {
        board.clearSelection()
        board.setTool('select')
      },
    },
    { id: 'delete', label: 'Delete', icon: 'trash', run: () => board.deleteSelection(), enabled: unlocked },
    { id: 'group', label: 'Group', icon: 'group', run: () => board.group(), enabled: () => sel().length > 1 },
    { id: 'ungroup', label: 'Ungroup', run: () => board.ungroup(), enabled: () => sel().some((it) => it.group) },
    {
      id: 'lock',
      label: 'Lock',
      icon: 'lock',
      run: () => board.toggleLock(),
      enabled: some,
      checked: () => some() && sel().every((it) => it.locked),
    },
    {
      id: 'add-reaction',
      label: 'Add reaction',
      icon: 'reaction-add',
      run: () => ui.openReactionPicker(singleNote().id),
      enabled: () => Boolean(singleNote()),
    },
    { id: 'front', label: 'Bring to front', icon: 'front', run: () => board.reorder('front'), enabled: some },
    { id: 'forward', label: 'Bring forward', run: () => board.reorder('forward'), enabled: some },
    { id: 'back', label: 'Send to back', icon: 'back', run: () => board.reorder('back'), enabled: some },
    { id: 'backward', label: 'Send backward', run: () => board.reorder('backward'), enabled: some },

    ...[
      ['up', 0, -1],
      ['down', 0, 1],
      ['left', -1, 0],
      ['right', 1, 0],
    ].flatMap(([dir, dx, dy]) => [
      { id: `nudge-${dir}`, label: `Move ${dir}`, run: () => board.nudge(dx, dy) },
      { id: `nudge-${dir}-far`, label: `Move ${dir} 10 px`, run: () => board.nudge(dx * 10, dy * 10) },
      { id: `duplicate-${dir}`, label: `Duplicate ${dir}`, run: () => board.duplicateBeside(dx, dy), enabled: some },
    ]),

    { id: 'zoom-in', label: 'Zoom in', icon: 'plus', run: () => board.zoomIn() },
    { id: 'zoom-out', label: 'Zoom out', icon: 'minus', run: () => board.zoomOut() },
    { id: 'zoom-reset', label: 'Zoom to 100%', run: () => board.zoomTo(1) },
    { id: 'zoom-fit', label: 'Zoom to fit', icon: 'fit', run: () => board.fitAll() },
    { id: 'zoom-selection', label: 'Zoom to selection', run: () => board.fitSelection(), enabled: some },
    { id: 'toggle-grid', label: 'Show grid', icon: 'grid', run: () => board.toggleGrid(), checked: () => board.view.grid },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', run: () => ui.openShortcuts() },

    { id: 'share', label: 'Share', icon: 'link', run: () => ui.share() },
    { id: 'export', label: 'Export board (.json)', icon: 'download', run: () => ui.exportBoard() },
    { id: 'import', label: 'Import from file…', icon: 'upload', run: () => ui.importBoard() },
    { id: 'rename', label: 'Change your name', icon: 'user', run: () => ui.rename() },
    { id: 'install', label: 'Install as app', icon: 'install', run: () => ui.install(), enabled: () => ui.canInstall() },
    { id: 'home', label: 'All boards', icon: 'home', run: () => ui.goHome() },
  ]

  const byId = new Map(list.map((c) => [c.id, c]))
  const get = (id) => {
    const c = byId.get(id)
    if (!c) throw new Error(`Unknown command: ${id}`)
    return c
  }

  return {
    get,
    label: (id) => get(id).label,
    shortcut: (id) => shortcutFor(id),
    isEnabled: (id) => !get(id).enabled || get(id).enabled(),
    isChecked: (id) => Boolean(get(id).checked?.()),
    /** Runs a command if it's enabled; returns whether it ran. */
    run(id) {
      const c = get(id)
      if (c.enabled && !c.enabled()) return false
      c.run()
      return true
    },
    /** A menu row for the design system's menus. */
    menuItem(id, { label, danger } = {}) {
      const c = get(id)
      return {
        label: label ?? c.label,
        icon: c.icon,
        hint: shortcutFor(id),
        danger,
        disabled: Boolean(c.enabled && !c.enabled()),
        run: () => this.run(id),
      }
    },
  }
}

const isTyping = (t) => t?.closest?.('input, textarea, select, [contenteditable]')

/** Runs the command bound to each key press. Returns a function that unbinds it. */
export function bindKeyboard(commands) {
  function onKeyDown(e) {
    if (e.defaultPrevented || isTyping(e.target) || document.querySelector('dialog[open]')) return
    // Enter and Space on a focused button press the button
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button, a')) return
    const entry = matchEvent(e)
    if (!entry || entry.native) return
    // a held key repeats only where repeating makes sense
    if (e.repeat && !entry.command.startsWith('nudge') && !entry.command.startsWith('zoom')) return
    if (commands.run(entry.command)) e.preventDefault()
    else if (entry.keys.some((k) => k.startsWith('mod+'))) e.preventDefault() // never the browser's ⌘D, ⌘G…
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
