// Static SVG icons (no user data: safe for innerHTML).
import logoSource from '../public/favicon.svg?raw'

const icon = (body) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

// the mark drawn in VectorCraft (branding/meshboard-icon.vectorcraft)
const logo = (size) =>
  logoSource
    .replace(/<\?xml[^>]*>\s*/, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/\s(id|data-name)="[^"]*"/g, '')
    .replace(/width="1024" height="1024"/, `width="${size}" height="${size}" aria-hidden="true" focusable="false"`)

export const ICONS = {
  logo: logo(28),
  logoLarge: logo(44),
  select: icon('<path d="M5 3l14 8-6.2 1.6L9.6 19z"/>'),
  hand: icon(
    '<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  ),
  note: icon('<path d="M4 4h16v10.5L14.5 20H4z"/><path d="M14 20v-6h6"/>'),
  rect: icon('<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>'),
  ellipse: icon('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  text: icon('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  arrow: icon('<path d="M5 19L18.5 5.5M10 5h9v9"/>'),
  undo: icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  redo: icon('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>'),
  front: icon('<rect x="3" y="3" width="12" height="12" rx="1.5"/><rect x="9" y="9" width="12" height="12" rx="1.5" fill="currentColor"/>'),
  back: icon('<rect x="9" y="9" width="12" height="12" rx="1.5"/><rect x="3" y="3" width="12" height="12" rx="1.5" fill="currentColor"/>'),
  duplicate: icon('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  link: icon('<path d="M10 14a4 4 0 005.7 0l3.6-3.6a4 4 0 00-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 00-5.7 0l-3.6 3.6a4 4 0 005.7 5.7l1.6-1.6"/>'),
  more: icon('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  fit: icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  download: icon('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: icon('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
  keyboard: icon('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  home: icon('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
  install: icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 7v5.5M9.5 10L12 12.5 14.5 10M8 20h8"/>'),
}
