/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow (e.g. /catlog/).
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      // auth-redirect.html is the tiny page Microsoft's sign-in popup returns to.
      input: { main: 'index.html', authRedirect: 'auth-redirect.html' },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        // The sign-in popup must load the real redirect page, never the cached app shell.
        navigateFallbackDenylist: [/auth-redirect\.html/],
      },
      manifest: {
        name: 'CatLog',
        short_name: 'CatLog',
        description: 'A calendar of your kitties’ poos, barfs and other events.',
        theme_color: '#2f6db5',
        background_color: '#f7f7f5',
        display: 'standalone',
        start_url: base,
        scope: base,
        // Long-press the app icon (Android and desktop) for these. On iPhone, use Shortcuts instead.
        shortcuts: [
          { name: 'Quick add', short_name: 'Quick', url: `${base}#/quick` },
          { name: 'Somebody pooed', short_name: 'Pooed', url: `${base}#/add?cat=somebody&type=Pooed&save=1` },
          { name: 'Somebody barfed', short_name: 'Barfed', url: `${base}#/add?cat=somebody&type=Barfed&save=1` },
        ],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
});
