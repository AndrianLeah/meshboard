// Renders public/favicon.svg into public/favicon.ico (16, 32 and 48 px), the icon Safari shows in
// its tabs: it ignores SVG favicons and asks for favicon.ico instead.
//
//   npm run favicon
//
// Run it after changing favicon.svg. Uses Playwright's Chromium (npx playwright install chromium).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const SIZES = [16, 32, 48]

const root = fileURLToPath(new URL('..', import.meta.url))
const source = `${root}public/favicon.svg`
const target = `${root}public/favicon.ico`

/** An .ico whose images are PNGs, as every browser since 2007 reads them. */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = header.length + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size % 256, 0) // 0 stands for 256
    entry.writeUInt8(size % 256, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

const svg = readFileSync(source, 'utf8')
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
try {
  const page = await browser.newPage()
  const images = []
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    )
    images.push({ size, png: await page.screenshot({ omitBackground: true }) })
  }
  writeFileSync(target, ico(images))
  console.log(`Wrote ${target} (${SIZES.join(', ')} px)`)
} finally {
  await browser.close()
}
