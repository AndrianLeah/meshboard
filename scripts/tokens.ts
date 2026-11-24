// Copies the design tokens exported from FigCraft (mockup/tokens/variables.css)
// into src/styles/tokens.css, the only place the app reads them from.
//
//   npm run tokens
//
// Edit the variables in mockup/meshboard-board-ui.figcraft, export them again
// (Variables → Export → CSS), then run this script. Never edit tokens.css by hand.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = `${root}mockup/tokens/variables.css`
const target = `${root}src/styles/tokens.css`

const css = readFileSync(source, 'utf8').replace(/\r\n/g, '\n').trim()

const vars = css.match(/--[\w-]+:/g) ?? []
if (vars.length < 40) throw new Error(`Only ${vars.length} variables in ${source}: is the export complete?`)

const header = `/*
 * Design tokens, generated from mockup/tokens/variables.css by \`npm run tokens\`.
 * Do not edit: change the variables in mockup/meshboard-board-ui.figcraft and export them again.
 */
`
writeFileSync(target, `${header}${css}\n`)
console.log(`tokens.css: ${vars.length} variables`)
