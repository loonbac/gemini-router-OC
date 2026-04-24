# Tasks: Dynamic Port per User

## Phase 1: Foundation — user-port module (test-first)

- [ ] 1.1 Create `src/user-port.test.ts` — RED: test `getUserPort()` with mocked `os.userInfo()` for uid 0 → 47890, uid 1000 → deterministic value in [47890,47989], uid 65534 → deterministic value in range
- [ ] 1.2 Add test: same uid called twice returns identical port (FR-1 determinism scenario)
- [ ] 1.3 Add test: Windows fallback (uid -1) hashes username string, returns value in [47890,47989]
- [ ] 1.4 Create `src/user-port.ts` — GREEN: implement `getUserPort()` with formula `47890 + (uid * 2654435761) % 100`, Windows username-hash fallback, export as single public function
- [ ] 1.5 Add test: `resolveEffectivePort()` respects precedence GEMINI_ROUTER_PORT > PORT > derived (FR-2 scenarios)
- [ ] 1.6 Implement `resolveEffectivePort()` in `src/user-port.ts` — three-tier env var resolution

## Phase 2: Integration — plugin.ts (test-first)

- [ ] 2.1 Update `src/plugin.test.ts` — add test: when no env vars, ROUTER_PORT uses `getUserPort()` instead of hardcoded 4789
- [ ] 2.2 Add test: `GEMINI_ROUTER_PORT` env overrides derived port; spawn child env gets correct PORT
- [ ] 2.3 Update `src/plugin.ts` — replace `Number(process.env.GEMINI_ROUTER_PORT ?? "4789")` with `resolveEffectivePort()`; update health check URL and spawn env to use resolved port

## Phase 3: Integration — server.ts (test-first)

- [ ] 3.1 Update `src/server.test.ts` — add test: when no env vars, PORT uses `getUserPort()` not 4789; update existing "port defaults to 4789" test
- [ ] 3.2 Add test: `PORT` env overrides derived; `GEMINI_ROUTER_PORT` overrides `PORT` (FR-2 via resolveEffectivePort)
- [ ] 3.3 Update `src/server.ts` — replace `Number(process.env.PORT ?? "4789")` with `resolveEffectivePort()`; health endpoint already reads PORT variable (no change needed there)

## Phase 4: Integration — install.ts (test-first)

- [ ] 4.1 Update `src/service/install.test.ts` — update "sets default port 4789" test to expect derived port instead
- [ ] 4.2 Add test: no `options.port` and no `PORT` env → unit file uses `getUserPort()` derived port
- [ ] 4.3 Update `src/service/install.ts` — replace `Number(process.env.PORT ?? "4789")` fallback with `getUserPort()` call

## Phase 5: Documentation & Verification

- [ ] 5.1 Update `README.md` — replace all "4789" references with dynamic port explanation; add "Multi-user support" section explaining port derivation; update env var table (PORT default → derived per user); add upgrade note about manual baseURL update
- [ ] 5.2 Run `npm test` — fix any failures from port derivation changes across all test files
