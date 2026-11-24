/**
 * GitHub Pages へ公開する（ビルドして、build/ の中身を gh-pages 枝へ強制プッシュする）。
 * 使い方: bun run deploy
 * 前提: このリポジトリに origin（GitHub）が設定されていること。
 */
import { $ } from 'bun';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const out = join(root, 'build');

const origin = (await $`git -C ${root} remote get-url origin`.text()).trim();
const rev = (await $`git -C ${root} rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git -C ${root} status --porcelain`.text()).trim();
if (dirty) console.warn('注意: コミットしていない変更があります。いまの作業中のファイルからビルドします。');

await $`bun run build`.cwd(root);
// GitHub Pages の Jekyll 処理を止める（_ で始まるファイルも、そのまま配る）
writeFileSync(join(out, '.nojekyll'), '');
if (existsSync(join(out, '.git'))) rmSync(join(out, '.git'), { recursive: true, force: true });

await $`git init -q -b gh-pages`.cwd(out);
await $`git add -A`.cwd(out);
await $`git commit -q -m ${`公開: ${rev}${dirty ? '（未コミットの変更を含む）' : ''}`}`.cwd(out);
await $`git push -q --force ${origin} gh-pages`.cwd(out);
rmSync(join(out, '.git'), { recursive: true, force: true });
console.log(`gh-pages へ公開しました（${rev}）`);
