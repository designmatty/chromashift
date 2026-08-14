# Performance and desktop-shell decision

This document records the 2026-08-11 bundle and process-memory baseline. The
goal is to make UI-library and Electron/Tauri decisions from ChromaShift data,
not generic framework reputation.

## Current decision

- Keep Chakra UI for the current milestone. A library rewrite is not the
  highest-value memory change.
- Release the main renderer when the app panel closes. Recreate it from
  product state when the user opens the app again.
- Release the mini-panel renderer after five seconds hidden. The short grace
  period keeps a quick tray reopen responsive without retaining a second
  renderer indefinitely.
- Disable Electron hardware acceleration. ChromaShift has no GPU-heavy canvas,
  video, or 3D surface, and the Windows measurements below show a material
  private-memory reduction. Revisit this if the renderer gains GPU-heavy work.
- Load the app panel and mini panel as separate lazy renderer entries.
- Keep Electron as the production shell and Electron Builder as the packager.
  The completed Tauri experiment remains comparison evidence, not an active
  migration path.

## UI stack comparison

These are different kinds of products:

- Chakra is a styled component system. It provides tokens, recipes, and
  accessible controls, and currently uses Emotion at runtime.
- Base UI and Radix Primitives are unstyled accessible behavior primitives.
  ChromaShift would own all visual CSS.
- shadcn is a source-generation and component-ownership workflow, not a runtime
  primitive library. Its current CLI can generate Base UI or Radix variants and
  normally pairs them with Tailwind.
- Astryx is a styled component system built with StyleX. It has broad component
  coverage but is still young compared with the other candidates.

The controlled micro-benchmark bundles React 19.2.8, React DOM, a button, text
input, checkbox, switch, slider, tooltip, and the same minimal layout CSS with
esbuild 0.25.12. Values include React so the incremental column is the useful
library comparison.

| Stack            | Version tested | Gzip total | Increment over React baseline | Modules transformed | Adopt guidance                                                                                           |
| ---------------- | -------------: | ---------: | ----------------------------: | ------------------: | -------------------------------------------------------------------------------------------------------- |
| Native controls  |              — |   60.96 KB |                             — |                  12 | Smallest, but insufficient for consistent accessible composite controls                                  |
| Radix Primitives |          1.6.7 |   88.06 KB |                      27.10 KB |                 113 | Best raw runtime result; pair directly with plain CSS if minimum bundle becomes the primary UI criterion |
| Base UI          |          1.7.0 |  110.39 KB |                      49.43 KB |                 237 | Best balance for a future no-Tailwind migration; broader modern primitives with application-owned CSS    |
| Astryx           |          0.3.0 |  134.98 KB |                      74.02 KB |                 141 | Re-evaluate after maturity improves; its required compiled CSS was 22.75 KB gzip in this sample          |
| Chakra UI        |         3.36.1 |  160.60 KB |                      99.64 KB |               1,909 | Keep for now; highest runtime cost, but already integrated and productive                                |

Chakra subpath imports reduced transformed modules from 1,909 to 1,711 but did
not reduce the emitted benchmark bundle. They are not a meaningful size fix.

### Same-application historical comparison

The parent of the Chakra migration is a particularly useful control: it is the
same ChromaShift product UI using shadcn 4.16.2, Base UI 1.7.0, and Tailwind
4.3.3. Both revisions were built with the same Node, Vite, React, and Electron
versions.

| ChromaShift renderer        | JavaScript raw |   CSS raw | JS + CSS gzip | JS + CSS Brotli |
| --------------------------- | -------------: | --------: | ------------: | --------------: |
| shadcn + Base UI + Tailwind |    1,249.25 KB |  78.70 KB |     245.94 KB |       197.13 KB |
| Chakra before lazy entries  |    1,404.96 KB |  19.09 KB |     265.61 KB |       214.40 KB |
| Difference                  |     +155.71 KB | -59.61 KB |     +19.67 KB |       +17.27 KB |

The real application penalty is therefore much smaller than the isolated
primitive delta: about 20 KB gzip. Tailwind's generated CSS and the exact set of
components matter. The completed Chakra-only renderer refactor measured 315.53
KB gzip after replacing the remaining application shell, profile list, mini
panel, shared controls, feature views, and browser-native settings selects with
Chakra components, style props, and semantic theme tokens. The composable Chakra
Select collection and floating-positioning path added 11.44 KB gzip over the
previous native-select build. The renderer no longer has an application-owned
CSS file; the small emitted CSS asset contains the bundled Fontsource
declarations. The later multi-expand Chakra Accordion and visual overhaul brought
the measured renderer total to 344.12 KB gzip. Adopting Chakra Dialog for the
profile-deletion confirmation brought the measured total to about 354.76 KB gzip.
The hard renderer budget is 360 KB gzip for all JavaScript and CSS, retaining a
small regression margin while dialog optimization is deferred, or 1.1 MB raw for
its largest JavaScript chunk.

Lazy app-panel and mini-panel entries do not materially change the app-panel
payload, but the mini-panel initial JavaScript and CSS path drops to about
241.39 KB gzip instead of loading app-panel-only features.

## Electron memory baseline

The measurement script launches the production build with isolated user data,
waits for validated product UI state, and takes repeated Windows process-tree
samples. `privateBytes` is committed memory private to the process. Aggregate
working set is also reported, but it can count shared pages in more than one
Chromium process.

Run:

```powershell
npm run measure:memory
```

Test host: Windows 11 Pro build 26200, Ryzen 9 9950X3D, 64 GB RAM, NVIDIA RTX
5090 driver 32.0.16.1088, Electron 43.3.0. Each state uses the median of repeated
samples; launch-to-launch ranges are reported where applicable.

### Before lifecycle optimization

Three clean launches showed:

| State                               |           Working set |         Private bytes | Renderer working set | Renderer private bytes |
| ----------------------------------- | --------------------: | --------------------: | -------------------: | ---------------------: |
| Chakra app panel visible            |      417.9 MiB median |      271.8 MiB median |     112.5 MiB median |        60.2 MiB median |
| Chakra app panel hidden             | effectively unchanged | effectively unchanged |             retained |               retained |
| Historical shadcn app panel visible |      400.6 MiB median |      269.7 MiB median |      93.3 MiB median |        41.2 MiB median |

Chakra costs roughly 19 MiB more renderer working set and private memory in this
comparison. Whole-app private memory differs by only about 2 MiB because the
Chromium GPU process varied in the opposite direction. This is why the script
reports process categories instead of relying only on a Task Manager total.

### After implemented lifecycle optimization

With software rendering and renderer release enabled, two clean launches
showed:

| State                      | Working-set range | Private-byte range |                                                                             Processes |
| -------------------------- | ----------------: | -----------------: | ------------------------------------------------------------------------------------: |
| App panel visible          |   398.3–401.1 MiB |    185.4–189.0 MiB |                 Electron main, renderer, GPU utility, network utility, DisplayService |
| Tray after app-panel close |   270.0–272.5 MiB |    126.9–129.6 MiB | Renderer released; Electron main, GPU utility, network utility, DisplayService remain |

Compared with the old hidden-window behavior, tray private memory fell by about
143 MiB and working set by about 146 MiB on this host. Closing the app panel now
removes the renderer instead of merely making it invisible. Disabling hardware
acceleration accounts for roughly 80 MiB of the private-memory improvement by
reducing the GPU process footprint; it does not eliminate Chromium's software
GPU process.

DisplayService itself measured around 17 MiB private and 52 MiB working set. It
is event-driven and is not the first optimization target. NativeAOT or trimming
may be investigated separately, but System.Management and vendor interop need
compatibility validation before changing its publish model.

## Electron versus Tauri

Electron still has a fixed idle floor after the renderer is gone: Electron main,
the software GPU process, and a utility process account for most of the remaining
roughly 110 MiB private memory before DisplayService. UI-library changes cannot
remove that floor.

A functional Tauri 2 port was completed at commit
`c0956613cc6932b8699bb93622fb97608734e1ab` using the same React/Chakra renderer
and C# DisplayService. Rust replaced Electron main and the TypeScript product
core. The port covered profile CRUD and activation, preview rollback, settings,
tray behavior, a real non-activating mini panel, normal and abrupt restoration,
and an NSIS package. Physical interaction testing found that the WebView2 mini
panel needed a Windows-specific `WM_MOUSEACTIVATE` guard; Tauri's focusability
options alone did not preserve foreground focus.

Measured on the same Windows 11 host, with private bytes as the primary metric:

| State             | Electron private | Tauri private | Result                               |
| ----------------- | ---------------: | ------------: | ------------------------------------ |
| App panel visible |        188.2 MiB |     280.9 MiB | Tauri 49.2% higher                   |
| Tray, no renderer |        127.7 MiB |      27.1 MiB | Tauri 78.7% lower                    |
| Mini panel only   |     not measured |     329.2 MiB | Tauri mini state needs investigation |

The Tauri NSIS installer was 26.53 MiB versus Electron's 129.0 MiB, and its
renderer-ready startup was 452 ms versus 1,229 ms in the comparison harness.
Those are real advantages, especially for a tray-first utility. They are offset
by the heavier visible WebView2 states on this host, the unexpectedly expensive
mini-panel state, duplicated Rust product logic with less parity-test depth, and
additional native Windows window handling.

Decision: keep Electron. The existing shell already has mature TypeScript domain
coverage, sandboxed and validated IPC, restore-safe DisplayService ownership,
non-activating window behavior, renderer lifecycle optimization, and packaged
desktop smoke. The upcoming UI and Milestone 5 hardening are lower risk in that
shell. Keep Electron Builder; Electron Forge does not solve a current packaging
or lifecycle gap.

Reconsider only if a future repeatable workload shows that Electron's tray floor
is unacceptable after renderer release, and the expected whole-lifecycle gain
justifies re-establishing domain-test parity, display restoration guarantees,
mini-panel behavior, signing, upgrades, and hardware validation in another
shell. The Tauri port remains useful as a runnable benchmark, not a roadmap item.

## Source references

- [Chakra installation and Emotion runtime](https://chakra-ui.com/docs/get-started/installation)
- [Base UI overview](https://base-ui.com/react/overview/about)
- [Radix Primitives overview](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [shadcn Base UI default and Radix option](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- [Astryx project](https://astryx.atmeta.com/)
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron process metrics API](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)
- [T3 Code reviewed reference](https://github.com/pingdotgg/t3code/tree/560d4a4560ddb5f42c8f8e0e35fa7827c0e46f80)
- [Tauri Windows prerequisites and WebView2](https://v2.tauri.app/start/prerequisites/)
- [Tauri external sidecars](https://v2.tauri.app/develop/sidecar/)
