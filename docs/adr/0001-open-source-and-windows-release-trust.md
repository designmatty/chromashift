---
status: accepted
---

# Open-source and Windows release trust

ChromaShift will publish its existing Git history and author metadata under the
MIT license with `ChromaShift contributors` as the copyright attribution. The
repository will permit issues and pull requests without soliciting contributions
or promising review or support. It will keep the NSIS installer as its primary
release. Direct releases will use Azure Artifact Signing Basic with an
individually validated publisher identity. This keeps installation and update
behavior on the path already tested, avoids making releases depend on SignPath
Foundation approval, and gives Windows a publicly trusted Authenticode identity
without adding a Microsoft Store package.

The open-source publication and the signing service are independent decisions.
The private-material and license-compliance audit is complete. Azure must sign
`ChromaShift.exe` and `ChromaShift.DisplayService.exe` before NSIS packages them,
then sign the final installer.

Open-source readiness and the signed draft release will finish while the
repository remains private. Making the repository public and publishing the
signed preview require explicit approval after the existing release gates pass.
No clean-system VM or SmartScreen reputation study is required.

The maintainer authorized unsigned `v0.1.0-preview.3` as a private-repository
hotfix cut to validate uninstall and Start menu cleanup. The first signed release
will be `v0.1.0-preview.4`. Stable `v0.1.0` can follow after ordinary use of the
signed preview.

The LGPL-3.0 `NvAPIWrapper.dll` ships beside `ChromaShift.DisplayService.exe` with
its license texts, notice, corresponding-source link, and a replacement-loading test.
The repository will support only its latest release for security reports and
will enable GitHub private vulnerability reporting without promising a response
deadline.
