# TermiX Agent Advantage Report

This is a submission template, not a fabricated result. Replace every placeholder with
artifacts captured from the same environment and time window before entering the TermiX track.

The report must contain at least three unique task pairs and at least one task in `trading`,
`equities`, or `security`. For every pair, retain the literal output produced without the agent,
the literal output produced with the agent, and durable evidence references for both attempts.

```json
{
  "agentId": "<registered-agent-id>",
  "generatedAt": 0,
  "cases": [
    {
      "id": "task-1",
      "task": "<task description>",
      "category": "trading",
      "withoutAgent": {
        "outcome": "completed",
        "durationMs": 0,
        "costMicrousd": 0,
        "qualityBps": 0,
        "output": "<captured manual output>",
        "evidenceRefs": ["<trace, tx, or artifact reference>"]
      },
      "withAgent": {
        "outcome": "completed",
        "durationMs": 0,
        "costMicrousd": 0,
        "qualityBps": 0,
        "output": "<captured agent output>",
        "evidenceRefs": ["<trace, tx, or artifact reference>"]
      }
    }
  ]
}
```

Do not claim “execution” from an activation signature alone. Attach explorer transaction links,
session-key records, or other independently verifiable artifacts when the task actually performs
an onchain action.
