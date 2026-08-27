# Display feasibility research

Status: current hardware record, first established on 2026-08-08 and extended by
later guarded tests. Windows and NVIDIA behavior is verified on the test machine.
AMD display operations remain explicitly unverified because no active monitor is
attached to the AMD adapter.

## Environment

| Item                 | Tested result                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Windows              | Microsoft Windows NT 10.0.26200.0                                                                                                      |
| Node / npm           | 24.11.1 / 11.6.2                                                                                                                       |
| .NET SDK             | 10.0.302                                                                                                                               |
| Electron             | 43.3.0                                                                                                                                 |
| NVIDIA GPU           | GeForce RTX 5090, WMI driver `32.0.16.1088` (NVIDIA 610.88)                                                                            |
| AMD GPU              | Radeon(TM) Graphics, WMI driver `32.0.21036.18`                                                                                        |
| AMD ADLX             | SDK headers 1.5.0.124; installed runtime 1.4.0.121                                                                                     |
| Primary display      | Samsung Odyssey G60SD, DP, serial HNAY301023, 359.999 Hz                                                                               |
| Secondary display    | ASUS VG278, DP, serial JCLMQS152284, 144.001 Hz                                                                                        |
| Active adapter paths | Both displays driven by NVIDIA; AMD iGPU has no active display                                                                         |
| HDR                  | Both displays report advanced-color support; G60SD HDR enabled for live gating/transition validation on 2026-08-14, VG278 remained SDR |

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

| Capability                 | Windows                                    | NVIDIA                               | AMD                                |
| -------------------------- | ------------------------------------------ | ------------------------------------ | ---------------------------------- |
| Adapter detection          | Verified                                   | Verified                             | Verified                           |
| Display enumeration        | Verified                                   | Verified                             | Implemented, unverified            |
| Stable display identity    | Verified across repeated enumeration       | Verified mapping to both GDI sources | Implemented, unverified            |
| HDR detection              | Verified in SDR and HDR-on states on G60SD | N/A                                  | N/A                                |
| Brightness                 | Verified gamma transform                   | Verified through Windows ramp        | Implemented, unverified (ADLX)     |
| Contrast                   | Verified gamma transform                   | Verified through Windows ramp        | Implemented, unverified (ADLX)     |
| Gamma                      | Verified exact ramp read/write/restore     | Verified through Windows ramp        | Implemented, unverified (ADLX LUT) |
| Saturation                 | Unsupported                                | Verified (NVAPI DVC)                 | Implemented, unverified (ADLX)     |
| Hue                        | Unsupported                                | Verified (private NVAPI)             | Implemented, unverified (ADLX)     |
| Color temperature          | Unsupported                                | Unsupported                          | Implemented, unverified (ADLX)     |
| Capability/range reporting | Verified                                   | Verified                             | Implemented, unverified            |
| State read                 | Verified                                   | Verified                             | ADLX initialized; no AMD display   |
| Exact restoration          | Verified                                   | Verified                             | Implemented, unverified            |

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
matching intentionally remains outside the helper. Because out-of-context
WinEvents can be delivered after Alt+Tab focus has already moved, each callback
is reconciled against the current `GetForegroundWindow` result. Native code does
not suppress repeated HWND events; Electron suppresses only duplicate activation
targets after a successful transition, preserving retry behavior.

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

NVIDIA DVC/hue writes under HDR remain deliberately untested. With HDR enabled
on the G60SD, ChromaShift detected the state and reported every Windows and
NVIDIA color capability unsupported; profile apply requests failed closed with
`HDR_UNSAFE` before mutation. The first live toggle also exposed repeated profile
attempts and an SDR-baseline restore attempt while HDR was active, so it did not
establish NVIDIA HDR write safety. ChromaShift treats HDR as a deferred
activation state, retains the immutable SDR baseline, and waits for HDR-off
before restoring or reapplying it. A guarded post-fix SDR/HDR/SDR sequence then
confirmed this behavior: HDR activation performed no provider writes, the
baseline owner remained validated through both topology refreshes, and returning
to SDR reapplied the saved profile without recapturing the baseline.

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
original gamma hash and 50/0. A later desktop regression test demonstrated that
abrupt Electron termination did not reliably deliver that EOF before the helper
was terminated. The Windows launch now detaches the helper and passes the Electron
PID; direct parent-process exit monitoring restored the exact guarded display
state after the same forced-termination sequence. Normal `service.shutdown`,
explicit per-display restore, restore-all, and partial-apply rollback use the
same verified path.

Parent-exit monitoring and EOF cover graceful shutdown and tested abrupt Electron
termination. ChromaShift also uses a two-second Electron heartbeat and independent
ten-second helper watchdog; a guarded integration test verified exact gamma-ramp
restoration after heartbeat loss. Abrupt helper crash, power loss, or OS
termination may still prevent cleanup because the process that owns the in-memory
baseline cannot restore after it has already disappeared.

## Multi-monitor and topology findings

Both active DisplayPort monitors enumerate independently with distinct stable
IDs, serials, refresh rates, primary state, GDI source mappings, and NVAPI
handles. Repeated enumeration returned the same IDs. An HDR-on transition was
observed on the G60SD with its stable ID preserved and the VG278 remaining SDR.
The 2026-08-14 guarded SDR/HDR/SDR transition advanced topology generations,
reacquired handles, kept the captured G60SD baseline ownership `validated`, and
returned the renderer from saved numeric values to muted `unavailable` labels
and back without losing profile data. The first SDR application captured gamma
hash `3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf`
once, both SDR legs produced the same verified applied hash
`438a956c38ec12ad82d0f75c9c2fc30191dce214d6c64ace5e9e5b0aad02ec86`,
and tray exit restored the original hash.

The same display then passed a guarded DisplayPort hot-unplug cycle during an
active Edit session. Topology generation 1 retained its baseline as
`disconnected`/`notConnected`; preview remained active, and Cancel transferred
the retained display ID back to activation without calling restore. The saved
Default target became `displayDisconnected`/deferred with no native capture or
apply. Generation 2 resolved the same stable display ID and ownership
`validated`, then reapplied hash
`438a956c38ec12ad82d0f75c9c2fc30191dce214d6c64ace5e9e5b0aad02ec86`.
No `DISPLAY_NOT_FOUND`, transition, activation, or restore failure occurred in
the unplug/cancel/reconnect interval, and tray exit restored the original
`3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf`
hash. The providers do not cache native display handles across calls, which
avoids blindly reusing stale handles.

The G60SD then passed a guarded HDMI disconnect/reconnect cycle. HDMI exposed
stable ID
`display:b361c05e6dea55c2141cae01b55b5cf220158a717afb90612a60a15add79c3b7`;
an active Edit moved its gamma hash from
`3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf` to
`1bbef12e9ac2806eef6de7e91afe9e37ad1c4067a5b061b7f29f9094221faff0`.
The first shutdown attempt while the output was absent exposed the former
`DISPLAY_NOT_FOUND` blocking path. Its non-blocking dialog kept the helper alive
beyond the ten-second watchdog, HDMI returned with the same ID, and retry restored
the exact original hash. A fresh independent helper then confirmed the VG278 DP,
G60SD HDMI, and G60SD DP outputs all had that original ramp. Explicit shutdown now
discards an absent output's in-memory restoration record instead of presenting
that error; persisted profile targets remain intact and reconnect normally.

The G60SD reports connector-specific EDID product codes (`75CB` on DP and `75C2`
on HDMI) despite the same serial. ChromaShift now preserves those as independent
native endpoint IDs while deriving shared physical ID
`display:4b518baf6fd688294cc0ddb625742692dfcb5cd16422ae9e80a565902d150c10`
from manufacturer `SAM` and serial `HNAY301023`. Profiles and normal UI use that
physical ID; native baseline ownership remains endpoint-specific. With both
paths connected, real desktop and forced-exit smoke confirmed one profile write
reached both endpoints and both exact baselines were restored. Sleep/wake,
lock/unlock, primary-display changes, and driver reset are issue-driven
post-release work.

## Known limitations and failures

- Windows gamma is a legacy global facility with documented overwrite and HDR
  limitations; read-back reduces but cannot remove those risks.
- HDR-on detection, capability shutdown, deferred activation, SDR recovery, and
  exact exit restoration are hardware-validated on the G60SD. Provider writes
  under HDR remain intentionally unsupported and untested.
- NVIDIA DVC and hue depend on undocumented/private interfaces and a replaceable
  LGPL-3.0 wrapper. The packaging contract is compliant, but driver compatibility
  remains a risk.
- No AMD-driven monitor was available. The ADLX implementation is not a claim of
  AMD hardware validation.
- The G60SD endpoint IDs are verified independently across DisplayPort and HDMI
  reconnect, and both map to one hardware-verified physical profile ID. Panels
  without trustworthy EDID serials intentionally remain endpoint-specific; other
  adapter and monitor combinations remain unverified.
- Parent-exit, EOF, and heartbeat restoration cannot recover from every possible
  native-service, power, or OS failure.

## Recommended production architecture

Keep the existing helper-process and per-capability provider design. Electron
should continue owning profiles, matching, persistence, activation precedence,
and user-facing errors. `DisplayService` should remain limited to enumeration,
events, validated native reads/writes, and baseline restoration.

| Product capability                                 | Recommended provider                                             |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Display/adapter/connection/HDR discovery           | Windows DisplayConfig + WMI EDID metadata                        |
| Foreground application                             | Windows out-of-context `EVENT_SYSTEM_FOREGROUND` hook            |
| NVIDIA brightness/contrast/gamma                   | Guarded Windows gamma ramp in SDR only                           |
| NVIDIA saturation/hue                              | Narrow private-NVAPI adapter with a replaceable LGPL wrapper     |
| AMD brightness/contrast/saturation/hue/temperature | Official ADLX custom-color interfaces after hardware validation  |
| AMD gamma                                          | Official ADLX re-gamma LUT after hardware validation             |
| Unsupported/unknown adapters                       | Report unsupported; never guess a vendor range or silently no-op |

These constraints still govern the shipped product:

1. Windows gamma may ship only with HDR gating, read-back verification, bounded
   transforms, baseline-first application, and emergency restoration.
2. NVIDIA private APIs remain compatibility-sensitive. Keep the replaceable
   wrapper and exact read-back/restoration checks.
3. AMD must be tested on at least one ADLX-supported, AMD-driven monitor before
   AMD support is advertised as verified.
4. Topology invalidation and heartbeat restoration are implemented. Additional
   transition and baseline-owning fault evidence is issue-driven post-release
   work; do not make a broad crash-safe hardware claim.
