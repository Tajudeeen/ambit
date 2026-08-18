-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "agentRegistry" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "identityRegistry" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "agentURI" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image" TEXT,
    "category" TEXT,
    "capabilities" TEXT[],
    "supportedProtocols" TEXT[],
    "verificationTier" TEXT NOT NULL DEFAULT 'unverified',
    "supportedExecution" BOOLEAN NOT NULL DEFAULT false,
    "executionVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedActivity" BOOLEAN NOT NULL DEFAULT false,
    "trustScoreValue" INTEGER,
    "trustConfidence" TEXT NOT NULL DEFAULT 'none',
    "trustConfidenceRank" INTEGER NOT NULL DEFAULT 0,
    "trustMethodologyVersion" TEXT,
    "trustComputedAt" TIMESTAMP(3),
    "lastIndexedBlock" INTEGER,
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMetadata" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "blockNumber" INTEGER,
    "txHash" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEndpoint" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastChecked" TIMESTAMP(3),
    "latencyMs" INTEGER,

    CONSTRAINT "AgentEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReputationEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientAddress" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueDecimals" INTEGER NOT NULL,
    "tag1" TEXT,
    "tag2" TEXT,
    "endpoint" TEXT,
    "feedbackURI" TEXT,
    "feedbackHash" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReputationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvidence" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'x402',
    "linkedTxHash" TEXT,
    "chainId" INTEGER,
    "reliable" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustScore" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPolicy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "maxTxValue" TEXT,
    "dailySpend" TEXT,
    "allowedTokens" TEXT[],
    "allowedProtocols" TEXT[],
    "allowedTargets" TEXT[],
    "expiry" TIMESTAMP(3),
    "maxSlippageBps" INTEGER,
    "minHealthFactor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "requester" TEXT,
    "sessionId" TEXT,
    "destination" TEXT NOT NULL,
    "calldata" TEXT,
    "protocol" TEXT,
    "requestedValue" TEXT NOT NULL,
    "requestStatus" TEXT NOT NULL DEFAULT 'pending-authorization',
    "policyResult" TEXT NOT NULL DEFAULT 'pending',
    "riskResult" TEXT,
    "simulationResult" TEXT,
    "approvalRejection" TEXT NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "callsId" TEXT,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "blockHash" TEXT,
    "executionStatus" TEXT,
    "gas" TEXT,
    "outcome" TEXT,
    "passportId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "agentCount" INTEGER NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "lastBlock" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentRegistry_key" ON "Agent"("agentRegistry");

-- CreateIndex
CREATE INDEX "Agent_category_idx" ON "Agent"("category");

-- CreateIndex
CREATE INDEX "Agent_verificationTier_idx" ON "Agent"("verificationTier");

-- CreateIndex
CREATE INDEX "Agent_chainId_idx" ON "Agent"("chainId");

-- CreateIndex
CREATE INDEX "Agent_trustScoreValue_trustConfidenceRank_idx" ON "Agent"("trustScoreValue", "trustConfidenceRank");

-- CreateIndex
CREATE INDEX "Agent_executionVerified_idx" ON "Agent"("executionVerified");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEndpoint_agentId_url_key" ON "AgentEndpoint"("agentId", "url");

-- CreateIndex
CREATE INDEX "ReputationEvent_agentId_idx" ON "ReputationEvent"("agentId");

-- CreateIndex
CREATE INDEX "ReputationEvent_clientAddress_idx" ON "ReputationEvent"("clientAddress");

-- CreateIndex
CREATE INDEX "ActivityEvent_agentId_idx" ON "ActivityEvent"("agentId");

-- CreateIndex
CREATE INDEX "PaymentEvidence_agentId_idx" ON "PaymentEvidence"("agentId");

-- CreateIndex
CREATE INDEX "TrustScore_agentId_idx" ON "TrustScore"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustScore_agentId_methodologyVersion_computedAt_key" ON "TrustScore"("agentId", "methodologyVersion", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRequest_clientRequestId_key" ON "ExecutionRequest"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRequest_passportId_key" ON "ExecutionRequest"("passportId");

-- CreateIndex
CREATE INDEX "ExecutionRequest_agentId_idx" ON "ExecutionRequest"("agentId");

-- CreateIndex
CREATE INDEX "ExecutionRequest_agentId_timestamp_idx" ON "ExecutionRequest"("agentId", "timestamp");

-- CreateIndex
CREATE INDEX "ExecutionRequest_timestamp_idx" ON "ExecutionRequest"("timestamp");

-- CreateIndex
CREATE INDEX "ExecutionRequest_txHash_idx" ON "ExecutionRequest"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "Attestation_epoch_key" ON "Attestation"("epoch");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCheckpoint_chainId_contract_key" ON "IndexerCheckpoint"("chainId", "contract");

-- AddForeignKey
ALTER TABLE "AgentMetadata" ADD CONSTRAINT "AgentMetadata_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEndpoint" ADD CONSTRAINT "AgentEndpoint_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReputationEvent" ADD CONSTRAINT "ReputationEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustScore" ADD CONSTRAINT "TrustScore_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPolicy" ADD CONSTRAINT "ExecutionPolicy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionRequest" ADD CONSTRAINT "ExecutionRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
