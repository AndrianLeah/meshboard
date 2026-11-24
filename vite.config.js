import { defineConfig } from 'vite'

// base relativa: funziona su https://utente.github.io/<repo>/ senza configurare nulla
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
})
