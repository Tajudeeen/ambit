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
  it('matches the SQL generated from the Prisma schema', () => {
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
    expect(normalize(readFileSync(generatedMigration, 'utf8'))).toBe(
      normalize(
        readFileSync(
          path.join(packageRoot, 'prisma', 'migrations', '20260817230000_initial', 'migration.sql'),
          'utf8',
        ),
      ),
    );
  });
});

function normalize(value: string): string {
  return value.replace(/\r\n/gu, '\n').trim();
}
