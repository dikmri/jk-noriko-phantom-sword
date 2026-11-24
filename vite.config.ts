import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(projectRoot, 'logs');
const logFile = path.join(logDir, 'game.log');

/** ブラウザから POST されたログ行を ./logs/game.log へ追記する。 */
function fileLogPlugin(): Plugin {
  const handler = (req: any, res: any) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(logFile, body.endsWith('\n') ? body : body + '\n', 'utf8');
        res.statusCode = 204;
      } catch (e) {
        res.statusCode = 500;
      }
      res.end();
    });
  };
  return {
    name: 'file-log',
    configureServer(server) {
      server.middlewares.use('/__log', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__log', handler);
    },
  };
}

export default defineConfig(({ command }) => ({
  // ビルドは相対パスにする（GitHub Pages の https://<user>.github.io/<リポジトリ>/ でも、そのまま動くように）
  base: command === 'build' ? './' : '/',
  plugins: [fileLogPlugin()],
  cacheDir: path.join(projectRoot, 'runtime', 'vite-cache'),
  // runtime/（モデルの元データ・Python の環境・Whisper のモデル）・ビルド・ログは見張らない
  server: { port: 5183, strictPort: false, host: '127.0.0.1', watch: { ignored: ['**/runtime/**', '**/build/**', '**/logs/**'] } },
  preview: { port: 5184, host: '127.0.0.1' },
  build: { outDir: 'build', target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
