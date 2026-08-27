# Public-source audit

Issue #44 prepared the repository for publication without rewriting Git history
or changing author metadata.

`npm run audit:public-source` inspects every blob reachable from local branches,
remote-tracking branches, and tags. It rejects credential-bearing filenames and
high-confidence private keys or service credentials, including deleted files
that remain in reachable history. The command reports a path and object ID, but
never prints a matched credential.

The 2026-08-27 audit also reviewed the tracked binary files and public-facing
text. The binary files are ChromaShift brand assets. Searches found no committed
private keys, access tokens, signing certificates, real environment files, or
private service addresses. Test-only Windows paths use the placeholder user
`test`. One historical Tauri benchmark records the maintainer's ChromaShift
worktree paths as measurement provenance; it exposes no credential or private
file. The signing variables in `.env.example` contain placeholders only.

The audit deliberately does not inspect or alter commit author names and email
addresses. Those are the existing author metadata that the publication decision
preserves.

This audit does not make the repository public. Publication remains a separate,
explicitly approved step.
