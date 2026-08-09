# Native protocol

Electron launches `DisplayService.exe` as a child process. Requests and responses
are UTF-8 newline-delimited JSON over stdin/stdout. Structured diagnostic logs use
stderr and cannot corrupt the protocol stream. Protocol version: `1`.

## Lifecycle

The service first emits:

```json
{"event":"service.ready","data":{"protocolVersion":1}}
```

Electron waits for readiness, detects process errors/exits, rejects outstanding
requests, and sends `service.shutdown` on exit. Shutdown restores every captured
baseline before acknowledging. EOF also triggers restore-all and a safe helper
exit, covering loss of the parent pipe. A later heartbeat is still needed for
failure modes where neither shutdown nor EOF cleanup can run.

## Envelopes

```json
{"id":"42","command":"display.apply","params":{"displayId":"display:abc","settings":{"gamma":1.15,"saturation":75}}}
{"id":"42","ok":true,"result":{}}
{"id":"42","ok":false,"error":{"code":"CAPABILITY_UNSUPPORTED","message":"Saturation is unavailable."}}
{"event":"foregroundApplicationChanged","data":{"application":{}}}
```

IDs are caller-generated strings. Events have no request ID. Unknown fields may
be added compatibly; breaking envelope or semantic changes require a protocol
version change.

## Commands

| Command | Parameters | Result / behavior |
|---|---|---|
| `system.info` | none | Protocol/service/OS/process data and native provider diagnostics |
| `displays.list` | none | Active displays, stable identity data, adapter, connection, HDR, refresh |
| `display.capabilities` | `displayId` | Per-control support/provider/range/default/reason and diagnostic native state |
| `display.state` | `displayId` | Current provider state and gamma-ramp hash; full Windows ramp where applicable |
| `display.apply` | `displayId`, `settings` | Captures baseline if needed, validates, applies, reads back, rolls back on failure |
| `display.restore` | `displayId` | Restores and releases that display's captured baseline |
| `baseline.capture` | `displayId` | Idempotently captures all controllable provider state |
| `baseline.restore` | `displayId` | Alias of `display.restore` |
| `baseline.restoreAll` | none | Attempts every captured display and returns per-display results |
| `foreground.current` | none | Current PID, executable/path, title, and transient monitor source |
| `service.shutdown` | none | Restores all baselines, acknowledges, and exits |

`display.apply.settings` accepts optional `brightness`, `contrast`, `gamma`,
`saturation`, `hue`, and `colorTemperature`. Omission means “do not override.”
Brightness, contrast, saturation, hue, and color temperature use normalized
product values 0–100. Product gamma is 0.5–2.8. Providers query and map native
ranges rather than persisting vendor values.

## Events

`foregroundApplicationChanged` originates from an out-of-context
`EVENT_SYSTEM_FOREGROUND` hook. It carries PID, executable filename, executable
path when accessible, window title, and transient GDI monitor source. Matching is
not performed in the native helper.

## Error codes

- `INVALID_JSON`, `INVALID_REQUEST`, `COMMAND_UNKNOWN`
- `DISPLAY_NOT_FOUND`, `CAPABILITY_UNSUPPORTED`, `HDR_UNSAFE`
- `VALUE_OUT_OF_RANGE`
- `GAMMA_READ_FAILED`, `GAMMA_WRITE_FAILED`, `GAMMA_VERIFY_FAILED`
- `NVIDIA_DISPLAY_NOT_FOUND`, `NVIDIA_VERIFY_FAILED`, `NVIDIA_RESTORE_FAILED`
- `AMD_NOT_AVAILABLE`, `AMD_DISPLAY_NOT_FOUND`, `AMD_ADLX_FAILED`,
  `AMD_VERIFY_FAILED`, `AMD_RESTORE_FAILED`
- `BASELINE_RESTORE_FAILED`, `COMMAND_FAILED`

Native failures are returned as errors and logged to stderr; they do not crash
Electron. Unsupported controls are explicit capability results and never silent
no-ops.

## TypeScript client surface

`@chromashift/native-client` runtime-validates command arguments and successful
results for the activation path. Its typed methods are:

| Method | Native command |
|---|---|
| `getDisplayState(displayId)` | `display.state` |
| `captureBaseline(displayId)` | `baseline.capture` |
| `applyDisplaySettings(displayId, settings)` | `display.apply` |
| `restoreDisplay(displayId)` | `display.restore` |
| `restoreAllBaselines()` | `baseline.restoreAll` |

Invalid product settings are rejected before a request is written. Malformed
success results are rejected at the client boundary. Native error responses are
raised as `NativeServiceError`, which retains `code`, `command`, `requestId`,
and the original native message for structured recovery and logging.
