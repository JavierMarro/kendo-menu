import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'script-defer',
      scope: '/',
      includeAssets: ['icons/kendo-menu-favicon.png', 'icons/kendo-menu-apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'KendoMenu',
        short_name: 'KendoMenu',
        description: 'KendoMenu helps you assemble focused kendo training sessions.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        lang: 'en',
        theme_color: '#0B1B33',
        background_color: '#0B1B33',
        prefer_related_applications: false,
        icons: [
          {
            src: '/icons/kendo-menu-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/kendo-menu-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/kendo-menu-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,jpg,jpeg}'],
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/(?:app(?:\/|$)|cookies(?:\/|$)|$)/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
