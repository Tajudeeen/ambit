import { timingSafeEqual } from 'node:crypto';
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
export const HIRE_AUTH_ENV = 'AMBIT_HIRE_TOKEN';

export interface CreateAppOptions {
  repository?: MarketplaceRepository;
  hireToken?: string | null;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const repository = options.repository ?? createPrismaMarketplaceRepository(prisma);
  const hireToken = options.hireToken ?? process.env[HIRE_AUTH_ENV] ?? null;
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
    (context, next) => requireHireAuthorization(context, hireToken, next),
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

async function requireHireAuthorization(
  context: Context,
  configuredToken: string | null,
  next: () => Promise<void>,
): Promise<Response | void> {
  if (!isUsableHireToken(configuredToken)) {
    return context.json(
      {
        error: {
          code: 'mutation-auth-unavailable',
          message: 'hire authorization is not configured',
        },
      },
      503,
    );
  }

  const authorization = context.req.header('authorization');
  const prefix = 'Bearer ';
  const presentedToken = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : null;
  if (!presentedToken || !matchesToken(presentedToken, configuredToken)) {
    return context.json(
      { error: { code: 'unauthorized', message: 'hire authorization required' } },
      401,
      { 'www-authenticate': 'Bearer' },
    );
  }

  await next();
}

function isUsableHireToken(token: string | null): token is string {
  return token !== null && token.length >= 16 && token.length <= 512 && /^[\x21-\x7e]+$/u.test(token);
}

function matchesToken(presentedToken: string, configuredToken: string): boolean {
  const presented = Buffer.from(presentedToken, 'utf8');
  const configured = Buffer.from(configuredToken, 'utf8');
  return presented.length === configured.length && timingSafeEqual(presented, configured);
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
