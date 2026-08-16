/**
 * M0 baseline indexer entrypoint.
 *
 * Real BSC ERC-8004 indexing lands in M1 (using @ambit/erc8004 ABIs and the
 * live registry addresses resolved from 8004scan /networks). This file asserts
 * the project wiring (config loads, packages resolve) so the M0 verification
 * gate is meaningful. It does NOT fabricate agents or scan chains.
 */
import { getConfig } from '@ambit/config';

export async function main(): Promise<void> {
  const cfg = getConfig();
  console.log(`[ambit-indexer] M0 baseline — BSC chainId=${cfg.bsc.chainId}`);
  console.log(`[ambit-indexer] ERC-8004 identity registry configured: ${cfg.erc8004.identityRegistry || '(pending M1)'}`);
  // M1 will: connect RPC, read Registered events, checkpoint, ingest.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[ambit-indexer] fatal', e);
    process.exit(1);
  });
}
