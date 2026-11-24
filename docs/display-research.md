# Display feasibility research

Status: current hardware record, first established on 2026-08-08 and extended by
later guarded tests. Windows and NVIDIA behavior is verified on the test machine.
AMD display operations are verified only on an integrated RDNA 2 display, in SDR
and under HDR; see the AMD hardware records (#119, #122).

## Environment

This table records the 2026-08-08 host. For the #119 AMD record, the VG278 moved
to the integrated AMD GPU, and for #122 the G60SD did; see the AMD hardware
records below.

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

| Capability                 | Windows                                    | NVIDIA                                    | AMD                                                 |
| -------------------------- | ------------------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| Adapter detection          | Verified                                   | Verified                                  | Verified                                            |
| Display enumeration        | Verified                                   | Verified                                  | Verified on integrated RDNA 2                       |
| Stable display identity    | Verified across repeated enumeration       | Verified mapping to both GDI sources      | Verified on integrated RDNA 2                       |
| HDR detection              | Verified in SDR and HDR-on states on G60SD | N/A                                       | Verified on integrated RDNA 2 (#122)                |
| Brightness                 | Verified gamma transform                   | Verified through Windows ramp             | Verified on integrated RDNA 2                       |
| Contrast                   | Verified gamma transform                   | Verified through Windows ramp             | Verified on integrated RDNA 2                       |
| Gamma                      | Verified exact ramp read/write/restore     | Verified through Windows ramp             | Verified on integrated RDNA 2 (Windows ramp)        |
| Saturation                 | Unsupported                                | Verified (NVAPI DVC)                      | Verified on integrated RDNA 2                       |
| Hue                        | Unsupported                                | Verified (private NVAPI)                  | Verified on integrated RDNA 2                       |
| Provider controls in HDR   | N/A                                        | Saturation and hue, owner-confirmed (#89) | All but gamma, verified on integrated RDNA 2 (#122) |
| Color temperature          | Unsupported                                | Unsupported                               | Verified on integrated RDNA 2                       |
| Capability/range reporting | Verified                                   | Verified                                  | Verified on integrated RDNA 2                       |
| State read                 | Verified                                   | Verified                                  | Verified on integrated RDNA 2                       |
| Exact restoration          | Verified                                   | Verified                                  | Verified on integrated RDNA 2                       |

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
and HDR behavior is undefined. ChromaShift therefore refuses profile gamma
application whenever HDR is reported active, and re-reads HDR state immediately
before each transformed ramp write. The #88 owner decision permits
restore-only writes of the captured ramp with read-back. Since #89, a display
may capture its baseline under HDR; AMD joined in #122. The ramp is read and stored as
usual, because the #88 hardware runs showed the ramp persisting across HDR
transitions and reading back exactly under HDR; the baseline records the color
mode. ChromaShift clamps product values, transforms
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
establish NVIDIA HDR write safety. At that time ChromaShift deferred restoration
until HDR-off. A guarded SDR/HDR/SDR sequence confirmed that historical behavior:
HDR activation performed no provider writes, the
baseline owner remained validated through both topology refreshes, and returning
to SDR reapplied the saved profile without recapturing the baseline.

The 2026-11-08 hardware findings and owner decision in #88 supersede that
restoration policy: stale SDR preview values remained visible under HDR. The
implementation restores captured gamma and vendor state immediately. The
owner's 2026-11-08 retest of #90, recorded on #88, confirmed restore-only
writes on the G60SD with read-back. The retest covered HDR-on during an edit,
HDR-off, Discard, a profile switch and tray Exit. It did not cover the watchdog
kill path, the mini-panel notice, a real restore failure, or AMD. AMD restore
under HDR was verified later in #122.

### HDR profile support (#89)

NVIDIA saturation and hue now apply while HDR is on. Each apply restores the
captured ramp and NVIDIA values, then writes Digital Vibrance and hue through
the same private-NVAPI provider, with read-back. The owner confirmed it
working on the G60SD with HDR on (reported 2026-11-23; `testing.md`, "Owner HDR
retest for #89"). AMD ADLX controls
also apply under HDR (#122); see the AMD HDR hardware record.

Windows ramp controls stay SDR-only: gamma on every adapter, and brightness and
contrast outside AMD. Candidates considered:

| Candidate                                                                           | Outcome                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-display SDR content brightness (the Windows "SDR content brightness" slider)    | Rejected. Setting it needs an undocumented `DisplayConfigSetDeviceInfo` request type, and the repository uses only documented Windows and GPU APIs. |
| HDR-aware transforms: an MHC2/ICC color profile or a DXGI output color-space change | Deferred. A different pipeline that replaces the user's color management state and needs its own capture and restore design.                        |
| The NVIDIA driver's own HDR color controls                                          | Deferred. Not exposed by public NVAPI; would widen the private-interface dependency.                                                                |
| The GDI ramp under HDR                                                              | Rejected. Microsoft documents HDR behavior as undefined; the ramp is only restored under HDR.                                                       |
| Keep brightness, contrast, and gamma SDR-only                                       | Chosen. Profiles keep one color vector, and these values apply when HDR turns off.                                                                  |

## AMD findings

The implementation binds directly to AMD's official
[ADLX SDK](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX) C ABI. It loads
`amdadlx64.dll`, queries the runtime version, initializes `IADLXSystem`,
enumerates `IADLXDisplay` instances, and accesses `IADLXDisplayCustomColor`. No
third-party AMD wrapper is used.

Brightness, contrast, saturation, hue, and color temperature independently query
support, current value, and native min/max/step. Product values are mapped into
the queried range so product neutral always lands on the AMD neutral point:
brightness 0, contrast 100, saturation 100, and 6500 K. Product 0 and 100 reach
the range ends, linearly on each side of neutral, aligned to the step. Product hue
is a 0–359° wheel with neutral at 0°. Turning from 0° toward 180° scales to AMD
neutral through the maximum, and from 359° back toward 180° through the minimum.
Writes require exact read-back. AMD documents these display interfaces in its
[ADLX display reference](https://gpuopen.com/manuals/adlx/adlx-sdk-references/adlx-interfaces/display/).

AMD gamma uses the guarded Windows ramp, as on other adapters, with the same
SDR-only gate, read-back, rejection retry, and exact restoration. The ADLX
re-gamma LUT is not used. `IADLXDisplayGamma.GetGammaRamp` returns `ADLX_FAIL`
while the driver uses re-gamma coefficients, its default state, so the LUT is not
capturable. The Windows ramp on the same display reads as the identity ramp.

### AMD hardware record (#119)

Owner host, 2026-11-20: Ryzen 9 9950X3D integrated AMD Radeon Graphics (RDNA 2,
`PCI\VEN_1002&DEV_13C0`), driver 32.0.21036.18, ADLX 1.4, ASUS VG278 over HDMI
in SDR at 59.94 Hz. The RTX 5090 drove the Odyssey G60SD at the same time.

- ADLX ranges: brightness -100 to 100, contrast 0 to 200, saturation 0 to 200,
  hue -30 to 30, color temperature 4000 to 10000 K.
- Original state: brightness 0, contrast 100, saturation 100, hue 0, 6500 K,
  re-gamma coefficients, Windows ramp hash
  `3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf`.
- Before #119, product-neutral hue and temperature wrote -30 and 7000 K.
- After #119: neutral writes AMD neutral, a mild apply with gamma 1.10 reads back
  exactly, and explicit restore, helper stop, and the heartbeat watchdog each
  return every value and the ramp hash to the original state. The driver stays on
  re-gamma coefficients after the restore.

### AMD HDR hardware record (#122)

Owner host, 2026-11-23: the same integrated AMD Radeon Graphics and ADLX 1.4
runtime as #119, with the Odyssey G60SD over HDMI at 120 Hz, 10 bits per channel,
and Windows HDR on. The RTX 5090 drove the other displays. Windows 11 build 26200.

- ADLX reads all five custom-color controls under HDR with the same ranges and
  neutral values as in SDR.
- Direct guarded ADLX writes under HDR (brightness -60, contrast 40, saturation 0,
  hue +25, 4000 K) each returned success, read back exactly, were visible on the
  panel, and restored exactly.
- HDR transitions, toggled with the documented `DisplayConfigSetDeviceInfo`
  advanced-color request: values applied under HDR survive HDR off and back on;
  values applied in SDR survive HDR on. Restore under HDR returns every value
  and holds through later HDR off and on.
- Rewriting the current Windows ramp under HDR succeeds with identical
  read-back, so a restore under HDR may include the captured ramp.
- ADLX gamma reports no current mode under HDR, and `GetGammaRamp` still returns
  `ADLX_FAIL`. Gamma stays SDR-only.

ADLX values persist across HDR transitions, so ChromaShift's restore-then-apply
on each transition stays responsible for HDR-specific output.

Discrete Radeon cards and several AMD-driven displays remain unverified.

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
- HDR-on detection, capability shutdown, deferred profile application, SDR
  recovery, and exact exit restoration after HDR-off were hardware-validated on
  the G60SD. The #88 restore-only writes under HDR passed the owner's NVIDIA
  retest of #90. Under HDR, NVIDIA saturation and hue apply (#89), owner-confirmed, and AMD ADLX controls apply (#122). Windows ramp
  controls stay SDR-only.
- NVIDIA DVC and hue depend on undocumented/private interfaces and a replaceable
  LGPL-3.0 wrapper. The packaging contract is compliant, but driver compatibility
  remains a risk.
- AMD is verified only on an integrated RDNA 2 display, in SDR and under HDR.
  Discrete Radeon cards and several AMD-driven displays remain unverified.
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

| Product capability                                 | Recommended provider                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Display/adapter/connection/HDR discovery           | Windows DisplayConfig + WMI EDID metadata                                                           |
| Foreground application                             | Windows out-of-context `EVENT_SYSTEM_FOREGROUND` hook                                               |
| NVIDIA brightness/contrast/gamma                   | Guarded Windows gamma ramp in SDR only                                                              |
| NVIDIA saturation/hue                              | Narrow private-NVAPI adapter with a replaceable LGPL wrapper; also under HDR (#89, owner-confirmed) |
| AMD brightness/contrast/saturation/hue/temperature | Official ADLX custom-color interfaces; also under HDR (#122)                                        |
| AMD gamma                                          | Guarded Windows gamma ramp in SDR only (#119)                                                       |
| Unsupported/unknown adapters                       | Report unsupported; never guess a vendor range or silently no-op                                    |

These constraints still govern the shipped product:

1. Windows gamma may ship only with HDR gating, read-back verification, bounded
   transforms, baseline-first application, and emergency restoration.
2. NVIDIA private APIs remain compatibility-sensitive. Keep the replaceable
   wrapper and exact read-back/restoration checks.
3. AMD support is advertised as verified only for tested hardware: currently an
   integrated RDNA 2 display, in SDR and under HDR.
4. Topology invalidation and heartbeat restoration are implemented. Additional
   transition and baseline-owning fault evidence is issue-driven post-release
   work; do not make a broad crash-safe hardware claim.
