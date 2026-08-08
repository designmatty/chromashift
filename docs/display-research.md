# Display feasibility research

Status: Phase 0 complete on 2026-08-08. The spike proves the native boundary,
Windows and NVIDIA behavior on the test machine, and an official AMD ADLX
implementation boundary. AMD display operations remain explicitly unverified
because no active monitor is attached to the AMD adapter.

## Environment

| Item | Tested result |
|---|---|
| Windows | Microsoft Windows NT 10.0.26200.0 |
| Node / npm | 24.11.1 / 11.6.2 |
| .NET SDK | 10.0.302 |
| Electron | 43.3.0 |
| NVIDIA GPU | GeForce RTX 5090, WMI driver `32.0.16.1088` (NVIDIA 610.88) |
| AMD GPU | Radeon(TM) Graphics, WMI driver `32.0.21036.18` |
| AMD ADLX | SDK headers 1.5.0.124; installed runtime 1.4.0.121 |
| Primary display | Samsung Odyssey G60SD, DP, serial HNAY301023, 359.999 Hz |
| Secondary display | ASUS VG278, DP, serial JCLMQS152284, 144.001 Hz |
| Active adapter paths | Both displays driven by NVIDIA; AMD iGPU has no active display |
| HDR | Both displays report advanced-color support, HDR disabled during tests |

## Toolchain and setup

Mise is used only to pin Node 24.11.1 and .NET SDK 10.0.302; it is not part of
application runtime. npm 11.6.2 is declared as the package manager, npm
workspaces contain the desktop and typed native client, and `package-lock.json`
is committed. A fresh dependency install was verified with `npm ci`.

With mise, setup is `mise install`, `npm install`, then `npm run dev`. Directly
installed matching Node/npm/.NET versions work identically. Root scripts expose
`dev`, `build`, `test`, `lint`, `typecheck`, `native:build`, `native:test`, and
`native:run` so no global npm packages or separate command knowledge is needed.

## Feasibility matrix

`Implemented, unverified` means the official API boundary, validation, range
mapping, read-back, and restoration paths exist, but matching hardware was not
available for a write test.

| Capability | Windows | NVIDIA | AMD |
|---|---|---|---|
| Adapter detection | Verified | Verified | Verified |
| Display enumeration | Verified | Verified | Implemented, unverified |
| Stable display identity | Verified across repeated enumeration | Verified mapping to both GDI sources | Implemented, unverified |
| HDR detection | Verified in SDR state | N/A | N/A |
| Brightness | Verified gamma transform | Verified through Windows ramp | Implemented, unverified (ADLX) |
| Contrast | Verified gamma transform | Verified through Windows ramp | Implemented, unverified (ADLX) |
| Gamma | Verified exact ramp read/write/restore | Verified through Windows ramp | Implemented, unverified (ADLX LUT) |
| Saturation | Unsupported | Verified (NVAPI DVC) | Implemented, unverified (ADLX) |
| Hue | Unsupported | Verified (private NVAPI) | Implemented, unverified (ADLX) |
| Color temperature | Unsupported | Unsupported | Implemented, unverified (ADLX) |
| Capability/range reporting | Verified | Verified | Implemented, unverified |
| State read | Verified | Verified | ADLX initialized; no AMD display |
| Exact restoration | Verified | Verified | Implemented, unverified |

## Windows findings

Display enumeration uses `QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS)` and
`DisplayConfigGetDeviceInfo` for source names, target names, adapter LUIDs, and
advanced-color state. `EnumDisplayDevices` and WMI fill adapter metadata and
`WmiMonitorID` supplies EDID-derived manufacturer, product, friendly name, and
serial data. Persisted IDs hash manufacturer + product + serial where those
fields exist, otherwise the monitor device path is the fallback. GDI indices
such as `DISPLAY6` are never persisted as identity.

The foreground watcher runs `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on a
dedicated message-loop thread. It resolved Notepad, Explorer/Electron, and Brave
events with PID, executable, accessible full path, title, and monitor. Profile
matching intentionally remains outside the helper.

Gamma uses `GetDeviceGammaRamp` and `SetDeviceGammaRamp` with three 256-entry
16-bit channels. The NVIDIA driver did not advertise `CM_GAMMA_RAMP` through
`GetDeviceCaps`, although direct reads and writes worked, so capability probing
falls back to a guarded read. Every write is read back byte-for-byte because the
API may report success while silently refusing a ramp.

Microsoft strongly discourages `SetDeviceGammaRamp`: it is global, other
software or display events can overwrite it, unsafe ramps can fail silently,
and HDR behavior is undefined. ChromaShift therefore refuses Windows gamma
operations whenever HDR is reported active, clamps product values, transforms
from the captured baseline rather than compounding profiles, and verifies every
write. This provider is feasible for the MVP but remains the largest Windows
reliability risk. See the official
[`SetDeviceGammaRamp` documentation](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdevicegammaramp).

## NVIDIA findings

The two active Windows paths map independently to NVAPI display handles. On both
displays, Digital Vibrance reported current/default 50 and range 0–100; hue
reported current/default 0 and range 0–359. A safe test applied product
saturation 55 and product hue 1%, which mapped to native saturation 55 and hue
4 degrees. Both values read back exactly and restored to 50/0.

The public [NVIDIA NVAPI SDK](https://github.com/NVIDIA/nvapi) is MIT licensed,
but its documented API does not expose desktop Digital Vibrance or hue. NVIDIA
also states that public NVAPI has no hue setter in its
[developer forum](https://forums.developer.nvidia.com/t/can-nvapi-expose-desktop-hue-setting/262040).
The spike therefore uses `Varun.NvAPIWrapper.Net` 9.0.3, an LGPL-3.0 wrapper
that calls private/undocumented NVAPI interface IDs for DVC and hue. The package
is a small, recent fork with low adoption. These interfaces worked with driver
610.88, but neither ABI stability nor future availability is guaranteed.

Production must keep this behind the current narrow provider, fail closed when
an interface disappears, re-query handles and ranges, and include driver-version
regression tests. Before distributing the MVP, perform an LGPL compliance/legal
review and decide whether to retain this wrapper or own the minimal interop.

HDR was not enabled during the write test. NVIDIA DVC/hue under HDR therefore
remains unverified and should be capability-disabled until tested rather than
inferred from the SDR result.

## AMD findings

The implementation binds directly to AMD's official
[ADLX SDK](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX) C ABI. It loads
`amdadlx64.dll`, queries the runtime version, initializes `IADLXSystem`,
enumerates `IADLXDisplay` instances, and accesses `IADLXDisplayCustomColor` and
`IADLXDisplayGamma`. No third-party AMD wrapper is used.

Brightness, contrast, saturation, hue, and color temperature independently query
support, current value, and native min/max/step. Product 0–100 values are mapped
into the queried range and aligned to its step; writes require exact read-back.
ADLX gamma is a 256×RGB re-gamma LUT rather than a scalar. The provider captures
that exact LUT, applies the same pure product gamma transform, writes the new LUT,
and verifies/restores it exactly. AMD documents these display interfaces in its
[ADLX display reference](https://gpuopen.com/manuals/adlx/adlx-sdk-references/adlx-interfaces/display/).

On this machine the installed ADLX 1.4.0.121 runtime initialized successfully
against the 1.5.0.124 SDK boundary, but returned zero displays because both
monitors are connected to NVIDIA. Runtime writes, per-display name/EDID mapping,
native ranges, HDR behavior, and restoration are consequently
`Implemented, unverified`, not `Verified`.

## Baseline and restoration results

The service captures each controlled provider value before the first write.
Windows transforms always start from that baseline. A multi-capability apply is
transactional at the service level: a failed capability attempts immediate
whole-display baseline restoration.

On the primary monitor, the baseline gamma SHA-256 was
`3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf`.
Gamma 1.02 produced
`16f666fd20da53751ee85cc30475031d38ea7e12f4332abfdc85a609cc2ad886`;
the read-back matched, and restore returned the exact baseline hash. NVIDIA
saturation/hue changed from 50/0 to 55/4 and restored to 50/0. The secondary
monitor independently captured and restored the same identity ramp and exposed
its own mapped NVAPI controls.

Closing stdin after a modified apply simulated loss of the Electron parent. The
helper restored gamma and NVIDIA state before exiting: a fresh helper read the
original gamma hash and 50/0. Normal `service.shutdown`, explicit per-display
restore, restore-all, and partial-apply rollback use the same verified path.

This EOF mechanism covers normal child-pipe loss, but is not a complete watchdog:
an abrupt helper crash, power loss, or OS termination cannot execute process
cleanup. A heartbeat/supervisor remains required during hardening.

## Multi-monitor and topology findings

Both active DisplayPort monitors enumerate independently with distinct stable
IDs, serials, refresh rates, primary state, GDI source mappings, and NVAPI
handles. Repeated enumeration returned the same IDs. Physical cable reconnect,
sleep/wake, primary changes, HDR toggles, and driver reset were not performed in
this spike; those are Milestone 5 tests. The providers do not cache native
display handles across calls, which avoids blindly reusing stale handles.

## Known limitations and failures

- Windows gamma is a legacy global facility with documented overwrite and HDR
  limitations; read-back reduces but cannot remove those risks.
- HDR-on behavior is not hardware-validated. Windows gamma is disabled in HDR;
  NVIDIA private controls should also remain disabled until explicitly tested.
- NVIDIA DVC and hue depend on undocumented/private interfaces and an LGPL-3.0
  wrapper that needs distribution review.
- No AMD-driven monitor was available. The ADLX implementation is not a claim of
  AMD hardware validation.
- Stable IDs were verified across enumeration, not physical reconnect cycles.
- EOF restoration is not a heartbeat watchdog and cannot recover from every
  possible native-service or OS failure.

## Recommended production architecture

Keep the existing helper-process and per-capability provider design. Electron
should continue owning profiles, matching, persistence, activation precedence,
and user-facing errors. `DisplayService` should remain limited to enumeration,
events, validated native reads/writes, and baseline restoration.

| Product capability | Recommended provider |
|---|---|
| Display/adapter/connection/HDR discovery | Windows DisplayConfig + WMI EDID metadata |
| Foreground application | Windows out-of-context `EVENT_SYSTEM_FOREGROUND` hook |
| NVIDIA brightness/contrast/gamma | Guarded Windows gamma ramp in SDR only |
| NVIDIA saturation/hue | Narrow private-NVAPI adapter, subject to compatibility and license decision |
| AMD brightness/contrast/saturation/hue/temperature | Official ADLX custom-color interfaces after hardware validation |
| AMD gamma | Official ADLX re-gamma LUT after hardware validation |
| Unsupported/unknown adapters | Report unsupported; never guess a vendor range or silently no-op |

Proceed to core-domain work only after accepting these Phase 0 constraints:

1. Windows gamma may ship only with HDR gating, read-back verification, bounded
   transforms, baseline-first application, and emergency restoration.
2. NVIDIA private APIs require a compatibility test matrix and packaging/legal
   decision before MVP distribution.
3. AMD must be tested on at least one ADLX-supported, AMD-driven monitor before
   AMD support is advertised as verified.
4. Topology invalidation and a real heartbeat watchdog belong in hardening before
   calling restoration crash-safe.

No polished profile UI should begin until these findings are reviewed.
