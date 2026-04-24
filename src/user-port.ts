/**
 * user-port.ts — Deterministic per-user port derivation
 *
 * Formula: port = 47890 + (uid * 2654435761) % 100
 * Range: [47890, 47989]
 *
 * Windows fallback: uid is -1, so we hash the username string instead.
 */

import { userInfo } from "os";

/**
 * Returns the base offset port derived from the current user's uid.
 * Uses Knuth multiplicative hash for deterministic distribution.
 */
export function getUserPort(): number {
  const info = userInfo();
  const uid = info.uid;

  if (uid === -1 || uid === undefined) {
    // Windows fallback: hash the username string
    return windowsUsernamePort(info.username);
  }

  return 47890 + ((uid * 2654435761) % 100);
}

/**
 * Windows fallback: hash username to a port in [47890, 47989].
 */
function windowsUsernamePort(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) & 0xffffffff;
  }
  return 47890 + (Math.abs(hash) % 100);
}

/**
 * Resolves the effective port using environment variable precedence:
 *   GEMINI_ROUTER_PORT > PORT > derived from getUserPort()
 */
export function resolveEffectivePort(): number {
  if (process.env.GEMINI_ROUTER_PORT !== undefined) {
    return Number(process.env.GEMINI_ROUTER_PORT);
  }
  if (process.env.PORT !== undefined) {
    return Number(process.env.PORT);
  }
  return getUserPort();
}
