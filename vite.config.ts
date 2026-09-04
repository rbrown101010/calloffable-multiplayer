import { defineConfig, loadEnv } from 'vite';
import lobbyHandler from './api/lobby.mjs';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);
  return {
    plugins: [{
      name: 'local-lobby-api',
      configureServer(server) {
        server.middlewares.use('/api/lobby', async (req: any, res: any) => {
          let raw = ''; for await (const chunk of req) raw += chunk;
          try {
            req.body = JSON.parse(raw || '{}');
            res.status = (code: number) => { res.statusCode = code; return res; };
            res.json = (data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
            await lobbyHandler(req, res);
          } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid request' })); }
        });
      },
    }],
    server: { hmr:process.env.PLAYWRIGHT_TEST?false:undefined, watch:{ignored:['**/output/**','**/work/**','.playwright-cli/**']}, port: 5178, strictPort: true, host: '127.0.0.1' },
    build: { target: 'esnext', chunkSizeWarningLimit: 5000 },
    optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
    assetsInclude: ['**/*.hdr', '**/*.glb', '**/*.gltf'],
  };
});
