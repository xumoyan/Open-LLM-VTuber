import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.english.tutor',
  appName: 'AI 外教',
  webDir: '../frontend/dist/web',
  ...(process.env.MOBILE_TEST_IP === '1'
    ? { server: { androidScheme: 'http' } }
    : {}),
};

export default config;
