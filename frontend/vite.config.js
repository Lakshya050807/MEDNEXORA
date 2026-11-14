import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // E2E runs point Vite at an empty temporary env directory so a local
  // developer .env file can never leak into a browser test build.
  const envDir = process.env.E2E_ENV_DIR || process.cwd();
  const configEnv = loadEnv(mode, envDir, '');
  return {
    plugins: [react()],
    envDir,
    server: {
      proxy: {
        '/api': {
          target: configEnv.API_PROXY_TARGET ?? process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5000',
          changeOrigin: false,
        },
      },
    },
  };
});

