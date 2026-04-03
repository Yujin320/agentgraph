import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const basePath = env.VITE_BASE_PATH || '/diagnouze';

  return {
    plugins: [react()],
    base: basePath + '/',
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:8001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
