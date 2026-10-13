import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.austinonal.editor',
  appName: 'ตัดต่อ',
  webDir: 'dist',
  // Light status/navigation bar icons on the app's dark background.
  plugins: { SystemBars: { style: 'DARK' } },
};

export default config;
