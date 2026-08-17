#!/usr/bin/env node
/**
 * Copies the canonical world files from `<repo>/data` into
 * `frontend/public/data` so the dev server and production build can serve them.
 *
 * The repo-root `data/` directory is the single source of truth — it is what the
 * C# tools in `/tools` read and write. Angular refuses to treat a directory
 * outside its own workspace root as an asset input, so instead of duplicating the
 * data by hand we mirror it on every `npm start` / `npm run build`.
 * `public/data/` is generated and git-ignored; never edit it directly.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'data');
const destination = resolve(here, '..', 'public', 'data');

async function main() {
  let entries;
  try {
    entries = await readdir(source);
  } catch (cause) {
    console.error(`[sync-data] Cannot read ${source}: ${cause.message}`);
    console.error('[sync-data] Expected the canonical world files at <repo>/data.');
    process.exitCode = 1;
    return;
  }

  const worldFiles = entries.filter((name) => name.endsWith('.json'));

  // Rebuild the mirror from scratch so a world deleted upstream does not linger.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const name of worldFiles) {
    await cp(join(source, name), join(destination, name));
  }

  if (worldFiles.length === 0) {
    // Not fatal: a brand-new or fully-wiped repo has no world file yet, and the
    // app's own load error + empty-world state is the right recovery path — a
    // failed `npm start` here would only get in the way of starting fresh.
    console.warn(
      `[sync-data] No .json world files found in ${source} — starting with an empty public/data/.`,
    );
    return;
  }

  console.log(
    `[sync-data] Mirrored ${worldFiles.length} world file(s) into public/data: ${worldFiles.join(', ')}`,
  );
}

await main();
