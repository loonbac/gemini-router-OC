# Proposal: dynamic-port-per-user

## Intent

The Gemini Router plugin currently binds to a fixed port (4789). In multi-user OS environments, this causes a port collision where the first user's router takes precedence, forcing subsequent users to connect to the first user's router and use their Gemini CLI auth. We need to derive a unique, deterministic port per user to allow isolated, per-user router instances.

## Scope

### In Scope
- Derive a unique port per OS user via a hash of the OS user ID (uid).
- Update the router server binding logic to use the derived port.
- Update the CLI plugin health check and spawn logic to target the derived port.
- Update the default port in the install service.
- Maintain support for `GEMINI_ROUTER_PORT` and `PORT` environment variable overrides.
- Document the dynamic port behavior in the README.

### Out of Scope
- Changes to the core opencode.json config file format.
- Implementing a multi-tenant single-instance router (we are sticking to one instance per OS user).

## Capabilities

### New Capabilities
- `dynamic-port`: Derivation of a unique, deterministic port per OS user.

### Modified Capabilities
None

## Approach

We will introduce a utility function to calculate a unique port based on the user's OS `uid`. The calculation will be: `47890 + (uid * 2654435761) % 100` (using a Knuth multiplicative hash or similar deterministic mapping within a 100-port range). This utility will be used by `server.ts` to bind the port, by `plugin.ts` to check health and spawn the server, and by `install.ts` for defaults. We will also update tests (`plugin.test.ts`, `server.test.ts`, `install.test.ts`, `template.test.ts`) to mock the `uid` and verify the correct port derivation. Environment variables will continue to take precedence over the derived port.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/plugin.ts` | Modified | Update health check and spawn URL to use derived port. |
| `src/server.ts` | Modified | Update server binding logic to use derived port. |
| `src/service/install.ts` | Modified | Update default port in installation logic. |
| `README.md` | Modified | Add documentation on dynamic port allocation. |
| `src/**/*.test.ts` | Modified | Update test suites to handle dynamic port derivation. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Port collision within the 100-port range | Low | The hash function ensures good distribution. |
| Breaking existing setups | Medium | Users with hardcoded `4789` in their config might need to update their `baseURL`. The install script will use the new derived port. |

## Rollback Plan

Revert the changes to hardcode port `4789` again. Restore the previous documentation and test files.

## Dependencies

- Node.js `os` module for retrieving user `uid`.

## Success Criteria

- [ ] Multiple OS users can start the Gemini Router simultaneously without port conflicts.
- [ ] Each user connects to their own isolated router instance.
- [ ] Environment variables `GEMINI_ROUTER_PORT` and `PORT` still override the derived port.
- [ ] All unit tests pass with the new dynamic port logic.