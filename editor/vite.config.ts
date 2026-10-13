import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './', // relative paths so the same build loads inside the Capacitor APK
  plugins: [react(), tailwindcss()],
});
