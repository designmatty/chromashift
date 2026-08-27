# Third-party native dependencies

## NVIDIA

`Varun.NvAPIWrapper.Net` 9.0.3 is referenced by `DisplayService`. The package is
licensed LGPL-3.0 and wraps NVIDIA's driver-provided NVAPI entry points. The DVC
and hue features used by this spike rely on private/undocumented function IDs,
not NVIDIA's stable public SDK contract.

Source and package metadata:

- https://github.com/varun875/NvAPIWrapper-V
- https://www.nuget.org/packages/Varun.NvAPIWrapper.Net/9.0.3
- https://github.com/NVIDIA/nvapi

The package places `NvAPIWrapper.dll` beside `ChromaShift.DisplayService.exe` and
includes the GPL and LGPL texts plus a third-party notice. The notice links the
exact source commit recorded in the NuGet package and explains how to install an
interface-compatible replacement. Package smoke verifies that the helper needs
the external library and starts after a replacement copy is installed.

## AMD

The AMD provider uses the installed `amdadlx64.dll` runtime through the official
ADLX C ABI. ChromaShift does not redistribute the ADLX DLL and does not depend on
a third-party AMD wrapper. SDK reference: https://github.com/GPUOpen-LibrariesAndSDKs/ADLX
