import { PrismaClient } from '@prisma/client';

export type { PrismaClient } from '@prisma/client';

/** Singleton Prisma client. In M1+ the indexer and API import this. */
export const prisma = new PrismaClient();

export * from '@prisma/client';
