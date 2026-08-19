import { pathToFileURL } from 'node:url';
import { main } from './indexer.js';

export * from './checkpoint.js';
export * from './indexer.js';
export * from './persistence.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[ambit-indexer] fatal', error);
    process.exit(1);
  });
}
