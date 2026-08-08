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

Do not ship a production installer without completing license-compliance review
and preserving the wrapper's required notices/source-access obligations.

## AMD

The AMD provider uses the installed `amdadlx64.dll` runtime through the official
ADLX C ABI. ChromaShift does not redistribute the ADLX DLL and does not depend on
a third-party AMD wrapper. SDK reference: https://github.com/GPUOpen-LibrariesAndSDKs/ADLX
