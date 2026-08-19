export const AGENT_ACTIVATION_MESSAGE_VERSION = '1' as const;

export interface AgentActivationMessageInput {
  agentRegistry: string;
  clientRequestId: string;
  requester: string;
  destination: string;
  protocol?: string;
  requestedValue: string;
  expiresAt: number;
}

export function buildAgentActivationMessage(input: AgentActivationMessageInput): string {
  return [
    'Ambit Agent Activation',
    `Version: ${AGENT_ACTIVATION_MESSAGE_VERSION}`,
    `Agent: ${input.agentRegistry}`,
    `Request: ${input.clientRequestId}`,
    `Requester: ${input.requester.toLowerCase()}`,
    `Destination: ${input.destination.toLowerCase()}`,
    `Protocol: ${input.protocol ?? 'unspecified'}`,
    `Value: ${input.requestedValue}`,
    `Expires: ${input.expiresAt}`,
    '',
    'This signature activates an agent request. It does not grant unlimited authority or prove execution.',
  ].join('\n');
}
