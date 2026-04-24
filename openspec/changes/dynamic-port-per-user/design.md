# Technical Design: Dynamic Port per User

## Architecture Decisions

- **UID Hashing:** We need a decentralized way to allocate a unique port per OS user so that multiple users on the same machine do not conflict when starting their own Gemini router instances. A Knuth multiplicative hash of the OS user ID (`uid`) modulo 100 is deterministic and provides excellent distribution without requiring a central registry or locking mechanism.
- **Port Range (47890-47989):** The base port 47890 is chosen to be visually reminiscent of the old default (4789) but shifted into the ephemeral/private range. The modulo 100 ensures the ports stay within a predictable 100-port window, minimizing the chance of conflicting with other services.
- **Windows Fallback:** Since `uid` is a POSIX concept, we must handle environments like Windows where `os.userInfo().uid` is -1 or undefined. In such cases, we will hash the username string instead, or default to a safe deterministic number based on the string hash of the username.

## New Module: `src/user-port.ts`

Instead of cluttering existing utility files like `cli-path.ts`, we will introduce a new standalone module: `src/user-port.ts`. This file will export a single primary utility function `getUserPort(): number`, which handles:
1. Detecting the `uid` or `username`.
2. Hashing the identity.
3. Calculating the offset from the base port `47890`.

## Data Flow

1. **`src/plugin.ts`:** 
   The plugin must know where to health-check and where to tell OpenCode to send traffic. It will resolve the port via `process.env.GEMINI_ROUTER_PORT ?? getUserPort()`.
2. **`src/server.ts`:** 
   The HTTP server needs to know which port to bind to. It will resolve the port via `process.env.PORT ?? getUserPort()`. (Note: The plugin spawns the server setting `PORT=calculated_port`, which keeps them in sync).
3. **`src/service/install.ts`:** 
   When creating the systemd user service, the install script will generate the unit template injecting the derived port: `options.port ?? Number(process.env.PORT ?? getUserPort())`.

## Environment Variable Precedence Chain

We must maintain the ability for users to explicitly override the port. The precedence order is:
1. Explicit Environment Variable (`GEMINI_ROUTER_PORT` in the plugin, `PORT` in the server/installer).
2. The derived dynamic port from `getUserPort()`.

## OpenCode Config Implications

Currently, users may have configured their OpenCode settings with a hardcoded `baseURL` pointing to `http://127.0.0.1:4789/v1`. 
When this change is deployed, their plugin will start the router on a different port (e.g., `47901`). Users relying on manual setup will need to update their OpenCode `baseURL` to match their new derived port, or set `GEMINI_ROUTER_PORT=4789` to restore the old behavior. We must document this clearly in the `README.md`.

## Systemd Service Implications

The `gemini-router.service` systemd unit is generated statically by `install.ts` and placed in `~/.config/systemd/user/`. Because the installer runs under the target user's context, `getUserPort()` will derive the correct port for that user at install time. The port is then hardcoded into the generated unit file as an `Environment="PORT=..."` directive. This guarantees the background service uses the exact same port the user's plugin will expect.

## Test Strategy

1. **`user-port.test.ts` (New):**
   - Mock `os.userInfo` to return `uid: 1000`. Verify port calculation (`47890 + (1000 * 2654435761) % 100`).
   - Mock `os.userInfo` to return `uid: -1` and simulate a Windows username. Verify the string hash calculation.
   - Verify determinism (same input always equals same output).
2. **`plugin.test.ts`, `server.test.ts`, `install.test.ts`:**
   - Override `getUserPort` or the environment variables to assert that the derived port is respected when `PORT` or `GEMINI_ROUTER_PORT` is unset, and overridden when they are set.
