# Native protocol

Electron launches `ChromaShift.DisplayService.exe` as a child process. Requests and responses
are UTF-8 newline-delimited JSON over stdin/stdout. Structured diagnostic logs use
stderr and cannot corrupt the protocol stream. Protocol version: `2`.

## Lifecycle

The service first emits:

```json
{ "event": "service.ready", "data": { "protocolVersion": 2 } }
```

Electron waits for readiness, detects process errors/exits, rejects outstanding
requests, and sends `service.shutdown` on exit. Shutdown restores every reachable
captured baseline and discards session restoration records for displays that are no
longer connected before acknowledging; persisted profile targets are owned by
Electron and are unchanged. On Windows the helper is detached from Electron's
terminating process group and receives `--parent-pid`; either parent-process exit
or stdin EOF triggers restore-all and a safe helper exit. After readiness the
client sends a heartbeat immediately and every two seconds. The helper arms a
dedicated watchdog on the first heartbeat and restores all baselines before
exiting if no heartbeat arrives for ten seconds. Native stdin is isolated on a
background reader so a blocked redirected-console read cannot prevent the main
lifecycle loop from observing parent exit or watchdog expiration.

Before enabling automation, Electron requires `system.info` and `service.health`
to agree on protocol and service versions, and requires an armed watchdog. A
restarted helper is accepted only when it reports no captured baselines; Electron
refreshes topology before requesting foreground state or resuming activation.
If the old helper may still own modified output, automatic restart fails closed
instead of recapturing that output as a new baseline. A helper crash, power loss,
or OS termination can still prevent in-process restoration and therefore remains
a physical fault-matrix item.

## Envelopes

```json
{"id":"42","command":"display.apply","params":{"displayId":"display:abc","settings":{"gamma":1.15,"saturation":75}}}
{"id":"42","ok":true,"result":{}}
{"id":"42","ok":false,"error":{"code":"CAPABILITY_UNSUPPORTED","message":"Saturation is unavailable."}}
{"event":"foregroundApplicationChanged","data":{"application":{}}}
{"event":"displayTopologyChanged","data":{"reason":"displaySettingsChanged"}}
```

IDs are caller-generated strings. Events have no request ID. Unknown fields may
be added compatibly; breaking envelope or semantic changes require a protocol
version change.

## Commands

| Command                    | Parameters              | Result / behavior                                                                                                                                                                |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.info`              | none                    | Protocol/service/OS/process data and native provider diagnostics                                                                                                                 |
| `service.health`           | none                    | Protocol/service identity, baseline-owner identity/count, process ID, and watchdog state                                                                                         |
| `service.heartbeat`        | none                    | Arms or resets the ten-second restoration watchdog                                                                                                                               |
| `displays.list`            | none                    | Active endpoint displays with unique `id`, profile-facing `physicalId`, EDID data, adapter, connection, HDR, and refresh                                                         |
| `display.capabilities`     | `displayId`             | Per-control support/provider/range/default/reason and diagnostic native state                                                                                                    |
| `display.state`            | `displayId`             | Current provider state and gamma-ramp hash; full Windows ramp where applicable                                                                                                   |
| `display.apply`            | `displayId`, `settings` | Captures baseline if needed, validates, applies, reads back, rolls back on failure                                                                                               |
| `display.topology.refresh` | none                    | Atomically re-enumerates displays, re-resolves capability/HDR reports, and validates retained baseline ownership                                                                 |
| `display.restore`          | `displayId`             | Restores and releases that display's captured baseline, including under HDR, with read-back verification                                                                         |
| `baseline.capture`         | `displayId`             | Idempotently captures all controllable provider state; refuses capture while HDR is active                                                                                       |
| `baseline.restore`         | `displayId`             | Alias of `display.restore`                                                                                                                                                       |
| `baseline.restoreAll`      | none                    | Attempts every captured display, including HDR displays, and returns per-display results; failed restores retain their captured baseline for retry                               |
| `foreground.current`       | none                    | Current PID, executable/path, title, and transient monitor source                                                                                                                |
| `service.shutdown`         | none                    | Restores connected baselines, returns disconnected entries as `reason: "displayDisconnected", discarded: true`, acknowledges, and exits; other restore failures remain retryable |

`display.apply.settings` accepts optional `brightness`, `contrast`, `gamma`,
`saturation`, `hue`, and `colorTemperature`. Although profile targets persist a
complete vector, Electron capability-filters each endpoint command. Omission at
this boundary means “use the captured baseline for this capability.” Brightness,
contrast, saturation, hue, and color temperature use normalized product values
0–100. Product gamma has a physical range of 0.3–2.8 and must also satisfy the
brightness-dependent safety envelope in `docs/core-domain.md`. Both the
TypeScript client and native helper validate that envelope. Providers query and
map native ranges rather than persisting vendor values.

Protocol v2 changes gamma application semantics and adds the following validated
result fields. `settings.gamma` and `applied.gamma`, when present, are the gamma
actually accepted. A successful GDI retry also returns `learnedGammaLimit`:

```json
{
  "displayId": "display:abc",
  "settings": { "brightness": 50, "gamma": 1.85 },
  "applied": { "gamma": 1.85, "gammaRampHash": "accepted-ramp-hash" },
  "learnedGammaLimit": {
    "end": "max",
    "value": 1.85,
    "brightness": 50,
    "colorMode": "sdr",
    "baselineHash": "captured-ramp-hash"
  }
}
```

`end` is `min` or `max`; limits must include neutral 1.0 and remain inside the
starting envelope. Only explicit `SetDeviceGammaRamp` rejection retries, with
0.05 steps toward neutral and no intervening restore. Every accepted ramp is
read back. Exhaustion includes neutral before whole-display restoration and the
existing rejection diagnostics. Read-back and other failures do not retry. HDR
and AMD write behavior are unchanged. TypeScript owns persistence and effective
envelope clamping; no native persistence or new request fields are introduced.

Native commands always accept the endpoint `id`; `physicalId` is identity
metadata for Electron grouping. The native baseline table is never keyed by a
physical ID because two connector endpoints for one panel may coexist and each
requires independent restoration.

## Events

`foregroundApplicationChanged` originates from an out-of-context
`EVENT_SYSTEM_FOREGROUND` hook. It carries PID, executable filename, executable
path when accessible, window title, and transient GDI monitor source. Matching is
not performed in the native helper.

`displayTopologyChanged` originates from the Windows display-settings event and
is only a refresh signal. Electron debounces it with screen and power events;
the helper does not write display state until the explicit topology refresh has
validated the current snapshot.

`service.baselinesRestored` is emitted after watchdog, parent-exit, EOF, or normal
loop termination restoration. It carries the same per-display result shape as
`baseline.restoreAll`, allowing the client to release conservative baseline
ownership tracking before it considers a replacement helper safe.

## Error codes

- `INVALID_JSON`, `INVALID_REQUEST`, `COMMAND_UNKNOWN`
- `DISPLAY_NOT_FOUND`, `CAPABILITY_UNSUPPORTED`, `HDR_UNSAFE`
- `VALUE_OUT_OF_RANGE`
- `GAMMA_READ_FAILED`, `GAMMA_WRITE_FAILED`, `GAMMA_VERIFY_FAILED`
- `NVIDIA_DISPLAY_NOT_FOUND`, `NVIDIA_VERIFY_FAILED`, `NVIDIA_RESTORE_FAILED`
- `AMD_NOT_AVAILABLE`, `AMD_DISPLAY_NOT_FOUND`, `AMD_ADLX_FAILED`,
  `AMD_VERIFY_FAILED`, `AMD_RESTORE_FAILED`
- `BASELINE_OWNERSHIP_CHANGED`, `BASELINE_RESTORE_FAILED`, `COMMAND_FAILED`

Native failures are returned as errors and logged to stderr; they do not crash
Electron. Unsupported controls are explicit capability results and never silent
no-ops.

## TypeScript client surface

`@chromashift/native-client` runtime-validates command arguments and successful
results for the activation path. Its typed methods are:

| Method                                      | Native command             |
| ------------------------------------------- | -------------------------- |
| `getServiceHealth()`                        | `service.health`           |
| `sendHeartbeat()`                           | `service.heartbeat`        |
| `getDisplayState(displayId)`                | `display.state`            |
| `refreshDisplayTopology()`                  | `display.topology.refresh` |
| `captureBaseline(displayId)`                | `baseline.capture`         |
| `applyDisplaySettings(displayId, settings)` | `display.apply`            |
| `restoreDisplay(displayId)`                 | `display.restore`          |
| `restoreAllBaselines()`                     | `baseline.restoreAll`      |

Invalid product settings are rejected before a request is written. Malformed
success results are rejected at the client boundary. Native error responses are
raised as `NativeServiceError`, which retains `code`, `command`, `requestId`,
and the original native message for structured recovery and logging.
