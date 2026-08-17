import { prisma } from '@ambit/db';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import {
  MarketplaceConflictError,
  MarketplaceNotFoundError,
  MarketplaceUnavailableError,
  RequestValidationError,
  isAgentRegistry,
  parseAgentSearchQuery,
  parseExecutionListQuery,
  parseHireAgentInput,
  type MarketplaceRepository,
} from './marketplace.js';
import { createPrismaMarketplaceRepository } from './prisma-repository.js';

export const health = (context: Context) => context.json({ status: 'ok', service: 'ambit-api' });
export const HIRE_REQUEST_BODY_LIMIT_BYTES = 16 * 1024;

export interface CreateAppOptions {
  repository?: MarketplaceRepository;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const repository = options.repository ?? createPrismaMarketplaceRepository(prisma);
  const app = new Hono();

  app.onError((error, context) => errorResponse(error, context));
  app.use('*', secureHeaders());
  app.get('/health', health);
  app.get('/ready', async (context) => {
    try {
      await repository.ready();
      return context.json({ status: 'ok', service: 'ambit-api' });
    } catch {
      return context.json(
        {
          status: 'unavailable',
          service: 'ambit-api',
          error: {
            code: 'repository-unavailable',
            message: 'marketplace repository is unavailable',
          },
        },
        503,
      );
    }
  });

  app.get('/agents', async (context) => {
    const query = parseAgentSearchQuery(context.req.query());
    return context.json(await repository.listAgents(query));
  });

  app.get('/agents/:agentRegistry/executions', async (context) => {
    const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
    const query = parseExecutionListQuery(context.req.query());
    return context.json(await repository.listExecutions(agentRegistry, query));
  });

  app.post(
    '/agents/:agentRegistry/hire',
    bodyLimit({
      maxSize: HIRE_REQUEST_BODY_LIMIT_BYTES,
      onError: (context) =>
        context.json(
          {
            error: {
              code: 'payload-too-large',
              message: `request body exceeds ${HIRE_REQUEST_BODY_LIMIT_BYTES} byte limit`,
            },
          },
          413,
        ),
    }),
    async (context) => {
      requireJsonContentType(context);
      const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
      let body: unknown;
      try {
        body = await context.req.json();
      } catch {
        throw new RequestValidationError(['request body must be valid JSON']);
      }
      const input = parseHireAgentInput(body);
      const request = await repository.createHire(agentRegistry, input);
      return context.json({ request }, 202);
    },
  );

  app.get('/agents/:agentRegistry', async (context) => {
    const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
    const agent = await repository.getAgent(agentRegistry);
    if (!agent) throw new MarketplaceNotFoundError('agent not found');
    return context.json({ agent });
  });

  return app;
}

function requireAgentRegistry(value: string): string {
  if (!isAgentRegistry(value)) throw new RequestValidationError(['agentRegistry is invalid']);
  return value;
}

function requireJsonContentType(context: Context): void {
  const mediaType = context.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new RequestValidationError(['content-type must be application/json']);
  }
}

function errorResponse(error: Error, context: Context): Response {
  if (error instanceof RequestValidationError) {
    return context.json(
      { error: { code: 'invalid-request', message: error.message, issues: error.issues } },
      400,
    );
  }
  if (error instanceof MarketplaceNotFoundError) {
    return context.json({ error: { code: 'not-found', message: error.message } }, 404);
  }
  if (error instanceof MarketplaceConflictError) {
    return context.json({ error: { code: 'conflict', message: error.message } }, 409);
  }
  if (error instanceof MarketplaceUnavailableError) {
    return context.json({ error: { code: 'repository-unavailable', message: error.message } }, 503);
  }
  return context.json(
    { error: { code: 'internal-error', message: 'unexpected marketplace API failure' } },
    500,
  );
}

export * from './marketplace.js';
export * from './prisma-repository.js';
