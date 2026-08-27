import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'ambit-migration-'));

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('production migration', () => {
  it('keeps authorization evidence in a forward-only migration', () => {
    const initialMigration = readMigration('20260817230000_initial');
    const authorizationMigration = readMigration(
      '20260827090000_execution_authorization_evidence',
    );

    expect(initialMigration).not.toContain('authorizationSignature');
    expect(authorizationMigration).toContain('ALTER TABLE "ExecutionRequest"');
    expect(authorizationMigration).toContain('ADD COLUMN "authorizationSignature" TEXT');
    expect(authorizationMigration).toContain(
      'ADD COLUMN "authorizationVerifiedAt" TIMESTAMP(3)',
    );
    expect(authorizationMigration).toContain(
      'ADD COLUMN "authorizationExpiresAt" TIMESTAMP(3)',
    );
  });

  it('generates the authorization evidence columns from the current schema', () => {
    const prismaExecutable = path.join(
      packageRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'prisma.CMD' : 'prisma',
    );
    const generatedMigration = path.join(temporaryDirectory, 'migration.sql');
    const result = spawnSync(
      prismaExecutable,
      [
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
        '--output',
        generatedMigration,
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const generated = normalize(readFileSync(generatedMigration, 'utf8'));
    expect(generated).toContain('"authorizationSignature" TEXT');
    expect(generated).toContain('"authorizationVerifiedAt" TIMESTAMP(3)');
    expect(generated).toContain('"authorizationExpiresAt" TIMESTAMP(3)');
  });
});

function readMigration(name: string): string {
  return normalize(
    readFileSync(path.join(packageRoot, 'prisma', 'migrations', name, 'migration.sql'), 'utf8'),
  );
}

function normalize(value: string): string {
  return value.replace(/\r\n/gu, '\n').trim();
}
