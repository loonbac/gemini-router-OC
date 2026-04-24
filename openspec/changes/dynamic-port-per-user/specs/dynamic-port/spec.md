# Dynamic Port Specification

## Purpose

Defines deterministic per-user port derivation so multiple OS users can run isolated Gemini Router instances simultaneously without port collision.

## Requirements

### FR-1: Deterministic Port Derivation

The system SHALL compute a unique port for each OS user via: `47890 + (uid * 2654435761) % 100`. The result MUST fall in range [47890, 47989]. Same uid MUST always yield the same port.

#### Scenario: Standard user gets derived port

- GIVEN a user with uid 1000
- WHEN the port is computed
- THEN the result is `47890 + (1000 * 2654435761) % 100` = a value in [47890, 47989]

#### Scenario: Root user (uid 0) gets BASE_PORT

- GIVEN a user with uid 0
- WHEN the port is computed
- THEN the result is `47890 + (0 * 2654435761) % 100` = 47890

#### Scenario: Determinism across calls

- GIVEN the same uid is used
- WHEN the port is computed multiple times
- THEN every call returns the identical port number

### FR-2: Environment Variable Precedence

The system MUST resolve the effective port in this order: (1) `GEMINI_ROUTER_PORT` env var, (2) `PORT` env var, (3) derived port from FR-1. The first defined value wins.

#### Scenario: GEMINI_ROUTER_PORT overrides all

- GIVEN env var `GEMINI_ROUTER_PORT=5000` is set
- AND env var `PORT=6000` is set
- WHEN the effective port is resolved
- THEN it SHALL be 5000

#### Scenario: PORT overrides derived when GEMINI_ROUTER_PORT absent

- GIVEN env var `GEMINI_ROUTER_PORT` is NOT set
- AND env var `PORT=6000` is set
- WHEN the effective port is resolved
- THEN it SHALL be 6000

#### Scenario: Derived port used when no env vars

- GIVEN neither `GEMINI_ROUTER_PORT` nor `PORT` is set
- WHEN the effective port is resolved
- THEN it SHALL be the value from FR-1

### FR-3: Server Binding

`server.ts` MUST bind to the effective port from FR-2 instead of hardcoded 4789.

#### Scenario: Server binds to derived port

- GIVEN no port env vars are set and current uid is 1001
- WHEN the server starts
- THEN it listens on the port derived for uid 1001

#### Scenario: EADDRINUSE from port collision

- GIVEN another process already occupies the derived port
- WHEN the server attempts to bind
- THEN it exits cleanly (code 0) per existing behavior

### FR-4: Plugin Health Check and Spawn

`plugin.ts` MUST use the effective port for health check URL, spawn env `PORT`, and `BASE_URL`.

#### Scenario: Plugin targets correct port

- GIVEN no port env vars and uid 1001 derives port P
- WHEN plugin checks health and spawns server
- THEN health check hits `http://127.0.0.1:P/health`
- AND spawn passes `PORT=P` in child env

### FR-5: Install Service Default Port

`install.ts` MUST use the derived port as default when no explicit `options.port` or `PORT` env is provided.

#### Scenario: Install without explicit port

- GIVEN no `options.port` and no `PORT` env
- WHEN `installService()` runs
- THEN the systemd unit uses the derived port for uid

### FR-6: Collision Handling

If two UIDs hash to the same port, the second server MUST exit cleanly on EADDRINUSE (existing FR-3 behavior). No additional collision detection is required.

#### Scenario: Two users hash to same port

- GIVEN uid A and uid B both derive port 47890
- WHEN user A starts router, then user B starts router
- THEN user B's server detects EADDRINUSE and exits cleanly

### FR-7: Upgrade Path (Backward Compatibility)

Users upgrading from hardcoded-4789 deployments MUST update their `opencode.json` baseURL. The install service SHALL regenerate the unit file with the new derived port. The system SHALL NOT attempt automatic migration of existing configs.

#### Scenario: Existing user upgrades

- GIVEN a user with uid 1000 previously had baseURL `http://127.0.0.1:4789/v1`
- WHEN they upgrade and re-run install
- THEN the systemd service binds to their derived port (not 4789)
- AND they MUST manually update opencode.json baseURL

## Non-Functional Requirements

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-1 | Port derivation MUST execute in O(1) time | Single arithmetic operation, no I/O |
| NFR-2 | Hash distribution SHOULD minimize collisions across typical UID ranges (1000-65534) | Knuth multiplicative constant provides good dispersion |
| NFR-3 | The derivation function MUST have zero external dependencies | Pure arithmetic, uses only Node.js `os.uid()` |
