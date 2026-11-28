# Tamma Local Export v1 Contract

## Invocation and trust

```sh
tamma export-local \
  --signing-key-file /secure/ed25519-seed-base64 \
  --output ./tamma-local-export-v1.tar.gz

tamma export-local \
  --verify ./tamma-local-export-v1.tar.gz \
  --trusted-key-file /secure/ed25519-public-base64
```

The signing file is a base64-encoded 32-byte Ed25519 seed. The trust file is the corresponding base64-encoded 32-byte public key, distributed out of band. `keyId` is the lowercase hex SHA-256 digest of the public key. The CLI never accepts private key bytes as an argument or writes them to output.

Export is restricted to legacy `single-user` mode. The operator must stop the API, engine, projectors, workers, and other database sessions. The offline reader opens repeatable-read, read-only transactions, checks for sibling sessions before and after capture, verifies ownership again, and compares watermarks. It does not run the web host, migrations, seeders, or secret resolution.

## Archive layout

The gzip-compressed USTAR archive contains exactly four regular files at its root:

| Member          | Contents                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metadata.json` | Format version, safe user and tenant metadata, applied migrations, and dataset counts.                                                                                                     |
| `state.sqlite`  | SQLite database with the rows described below.                                                                                                                                             |
| `manifest.json` | Canonical UTF-8 JSON source revision, migration IDs, capture time, owner IDs, durable watermark, dataset row counts, payload byte sizes, SHA-256 digests, signature algorithm, and key ID. |
| `manifest.sig`  | Raw 64-byte Ed25519 signature over the exact bytes of `manifest.json`.                                                                                                                     |

Tar member order, ownership, permissions, timestamps, JSON property order, migration order, dataset order, and row order are stable. Repeating an unchanged capture with the same capture timestamp produces identical archive bytes; normal captures have distinct capture timestamps but equivalent dataset content.

The SQLite schema is intentionally small and stable:

```sql
CREATE TABLE export_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE datasets (name TEXT PRIMARY KEY, row_count INTEGER NOT NULL CHECK(row_count >= 0));
CREATE TABLE export_rows (
  dataset TEXT NOT NULL REFERENCES datasets(name),
  ordinal INTEGER NOT NULL,
  id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(dataset, ordinal),
  UNIQUE(dataset, id)
);
```

`ordinal` is zero-based. Events are ordered by `sequenceNumber`; agent versions by agent and version; documents by issue, type, revision, and ID; all other rows by stable source ordering. `payload_json` is a JSON object whose `id` equals the row ID. Import must use the dataset name and source ID as its idempotency key, so importing the same verified archive twice does not duplicate state.

## Field inventory

All field names below are lower camel case in `payload_json`. No entity navigation properties or source connection metadata are exported.

| Dataset                                       | Owner and source                                            | Fields                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant.domain_events`                        | Personal tenant / `DomainEvent`                             | `id`, `sequenceNumber`, `type`, `tenantId`, `issueNumber`, `tags`, `metadata`, `data`, `createdAt`                                                                                                                                                                                  |
| `tenant.documents`                            | Personal tenant / `DocumentInstance`                        | `id`, `documentType`, `issueId`, `producedByRole`, `producedByAction`, `producedByWorkflow`, `schemaVersion`, `correlationId`, `revision`, `status`, `supersedesDocumentId`, `parentDocumentId`, `correlatingEventId`, `tenantId`, `audience`, `bodyJson`, `createdAt`, `updatedAt` |
| `tenant.conventions`                          | Personal tenant / `Convention`                              | `id`, `tenantId`, `role`, `action`, `body`, `version`, `enabled`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`                                                                                                                                                                |
| `tenant.budget_configs`                       | Personal tenant / `BudgetConfig`                            | `id`, `tenantId`, `accountId`, `limitUsd`, `alertThreshold`, `periodDays`, `createdAt`, `updatedAt`                                                                                                                                                                                 |
| `tenant.prompt_overrides`                     | Sole user or personal tenant / `PromptOverride`             | `id`, `userId`, `tenantId`, `scope`, `role`, `action`, `template`, `systemPrompt`, `variables`, `enableTools`, `maxTokens`, `version`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`                                                                                           |
| `tenant.acceptance_rules_overrides`           | Sole user or personal tenant / `AcceptanceRulesOverride`    | `id`, `userId`, `tenantId`, `documentTypeKey`, `rulesJson`, `version`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`                                                                                                                                                           |
| `tenant.agent_configs`                        | Personal tenant / `AgentConfig`                             | `id`, `tenantId`, `config`, `version`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`                                                                                                                                                                                           |
| `tenant.orchestrator_agent_configs`           | Sole user or personal tenant / `OrchestratorAgentConfigRow` | `id`, `userId`, `tenantId`, `configJson`, `version`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`                                                                                                                                                                             |
| `tenant.workflow_definitions`                 | Personal tenant / `WorkflowDefinition`                      | `id`, `name`, `description`, `version`, `steps`, `tenantId`, `syncedAt`, `createdAt`, `updatedAt`                                                                                                                                                                                   |
| `tenant.workflow_instances`                   | Personal tenant / `WorkflowInstance`                        | `id`, `definitionId`, `tenantId`, `status`, `currentActivity`, `variables`, `result`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`                                                                                                                                          |
| `control_plane.action_assignments`            | Sole user or personal tenant / `ActionAssignment`           | `id`, `tenantId`, `userId`, `targetKind`, `targetKey`, `minAutonomy`, `enforce`, `enabled`, `allowedRoles`, `note`, `version`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`                                                                                                   |
| `control_plane.action_authorizations`         | Sole user or personal tenant / `ActionAuthorization`        | `id`, `tenantId`, `userId`, `correlationId`, `targetKind`, `targetKey`, `state`, `requestedAtUtc`, `decidedAtUtc`, `decidedByUserId`, `expiresAtUtc`, `consumedAtUtc`, `scope`, `reason`, `autonomyLevelAtRequest`                                                                  |
| `control_plane.provider_settings`             | Sole user or personal tenant / `ProviderSetting`            | `id`, `tenantId`, `userId`, `scope`, `providerKey`, `defaultModel`, `enabled`, `updatedAt`, `updatedBy`                                                                                                                                                                             |
| `control_plane.agent_role_selections`         | Sole user or personal tenant / `AgentRoleSelection`         | `id`, `tenantId`, `userId`, `role`, `agentId`, `visibility`, `createdAt`, `updatedAt`, `updatedBy`                                                                                                                                                                                  |
| `control_plane.agent_run_waits`               | Sole user or personal tenant / `AgentRunWait`               | `id`, `tenantId`, `userId`, `repository`, `branchName`, `sessionId`, `installationId`, `workflowInstanceId`, `bookmarkName`, `bookmarkTenantId`, `workflowFile`, `status`, `workflowRunId`, `dispatchedAt`, `receivedAt`, `createdAt`, `updatedAt`                                  |
| `control_plane.tenant_agent_enablements`      | Sole user or personal tenant / `TenantAgentEnablement`      | `id`, `tenantId`, `userId`, `agentId`, `enabled`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                                                                                                                |
| `control_plane.tenant_platform_installations` | Personal tenant / `TenantPlatformInstallation`              | `id`, `tenantId`, `platformKind`, `baseUrl`, `installationExternalId`, `status`, `isPrimary`, `metadataJson`, `createdAt`, `updatedAt`, `credential`, `webhookCredential`                                                                                                           |
| `control_plane.agents`                        | Sole user or personal tenant private / `Agent`              | `id`, `name`, `role`, `visibility`, `ownerTenantId`, `ownerUserId`, `status`, `currentVersionId`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                                                                |
| `control_plane.agent_versions`                | Versions of exported private agents / `AgentVersion`        | `id`, `agentId`, `version`, `configJson`, `notes`, `createdAt`, `createdBy`                                                                                                                                                                                                         |

Platform-global `ActionLevelOverride` rows, public agents, billing state, auth sessions, API keys, password hashes, reset tokens, refresh tokens, secret-store rows, tenant connection strings, encryption envelopes, signing keys, and decryption material are not locally owned state and are excluded. Live Elsa bookmarks remain owned by Story 47-8; durable agent-run correlation is retained without exporting live bookmark state.

## Secret and verification rules

JSON columns (`settings`, `tags`, `metadata`, `data`, `bodyJson`, `rulesJson`, `config`, `configJson`, `steps`, `variables`, `result`, and installation `metadataJson`) are parsed and recursively scrubbed before SQLite serialization. Malformed JSON fails the export. Credential-shaped names, passwords, tokens, connection strings, authorization values, private keys, and encrypted envelopes become:

```json
{ "$tamma": "reauthorize", "kind": "credential" }
```

Platform installations use `git-platform` and `webhook` marker kinds. Secret assignments, bearer values, URL user information, and common provider-token forms are also removed from free text. Re-authorization is intentionally required on TammaDesktop; no credential value or reusable reference is carried forward.

A reader must reject unknown versions, unexpected or duplicate members, unsafe paths, excessive expansion, invalid signatures, untrusted key IDs, digest/size mismatches, malformed SQLite, unexpected tables, missing datasets, and row-count mismatches before any import write. The exporter verifies the staged archive with the same verifier, publishes only by same-filesystem atomic rename, and removes private staging on success or failure.
