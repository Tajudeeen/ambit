import { marketplaceApiUrl } from '@/lib/marketplace-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentRegistry: string }> },
) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      {
        error: {
          code: 'invalid-request',
          message: 'request body must be valid JSON',
          issues: ['request body must be valid JSON'],
        },
      },
      { status: 400 },
    );
  }

  const body = isRecord(input)
    ? {
        clientRequestId: input.clientRequestId,
        requester: input.requester,
        destination: input.destination,
        protocol: input.protocol,
        requestedValue: input.requestedValue,
      }
    : {};
  const { agentRegistry } = await params;

  try {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    const hireToken = process.env.AMBIT_HIRE_TOKEN;
    if (hireToken) headers.authorization = `Bearer ${hireToken}`;
    const response = await fetch(
      `${marketplaceApiUrl()}/agents/${encodeURIComponent(agentRegistry)}/hire`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'repository-unavailable',
          message: 'The marketplace is unavailable. No hire request was created.',
        },
      },
      { status: 503 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
