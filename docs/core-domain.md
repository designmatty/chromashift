# Core domain

Phase 1 lives in `packages/core` and has no dependency on Electron, Node APIs,
or GPU vendors. It contains product decisions that will be connected to the
native client during Milestone 2.

## Profile configuration

The persisted root object has schema version 1:

```json
{
  "schemaVersion": 1,
  "profiles": [],
  "settings": {
    "defaultProfileId": null
  }
}
```

A profile contains vendor-neutral color settings, application rules, and stable
display IDs. Brightness, contrast, saturation, hue, and color temperature use
normalized values from 0 through 100. Gamma uses the product range 0.5 through
2.0 already accepted by the native protocol. Every color setting is optional;
an omitted field means that the profile does not override that capability.

Zod validates the complete persisted document. Profile IDs and display targets
must be unique case-insensitively, and a configured default must reference an
existing profile. Unknown fields are rejected so vendor-native values cannot
silently enter the product model.

`JsonProfileRepository` owns validation, serialization, CRUD, duplication, and
default-profile maintenance. Its small `ProfileConfigurationStorage` interface
keeps the app-data filesystem decision in Electron main while allowing the
repository to be tested without filesystem state. Returned objects are cloned
so callers cannot mutate repository state without a successful save.

An explicit version 0 migration moves the former top-level `defaultProfileId`
into `settings`. Loading legacy JSON rewrites it at the current version. Invalid
or unknown versions fail explicitly and are never replaced with an empty
configuration.

## Application matching

Application matching is Windows-case-insensitive and supports both slash forms.
Each rule stores an executable filename and may store the preferred full path.

- When both the rule and foreground event have a path, only an exact normalized
  path matches. A same-named executable at a different known path does not.
- When a path is unavailable on either side, the executable filename is the
  fallback.
- Exact path matches outrank filename-only matches. Ties preserve profile order.
- Disabled profiles never match.

This keeps normal access-denied foreground events usable without discarding the
stronger identity available from a full path.

## Activation

`selectActivation` implements the required precedence:

```text
valid enabled manual override
  > foreground application profile
  > valid enabled default profile
  > baseline
```

An invalid or newly disabled manual override safely falls back to automatic
selection. `ActivationResolver` adds only transition state: it reports whether
the desired target differs from the current target, allowing the integration
layer to avoid duplicate display writes. `reset()` invalidates that state after
an external baseline restore or native-service restart.

The resolver is synchronous and processes foreground events in arrival order.
It does not call the native service; applying and restoring display state belong
to Milestone 2.
