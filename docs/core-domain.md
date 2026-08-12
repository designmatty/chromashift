# Core domain

Phase 1 lives in `packages/core` and has no dependency on Electron, Node APIs,
or GPU vendors. It contains the product decisions connected to the native client
by Electron main during Milestone 2.

## Profile configuration

The persisted root object has schema version 2:

```json
{
  "schemaVersion": 2,
  "profiles": [],
  "settings": {
    "defaultProfileId": null
  }
}
```

A profile contains application rules and a list of display targets keyed by
stable display ID. Color settings belong to the target, not the profile, so two
displays in one profile can hold different values:

```json
{
  "id": "tarkov-night",
  "name": "Tarkov - Night",
  "enabled": true,
  "applications": [{ "executableName": "EscapeFromTarkov.exe" }],
  "displays": [
    { "displayId": "display:abc", "color": { "brightness": 84 } },
    { "displayId": "display:def", "color": {} }
  ]
}
```

Brightness, contrast, saturation, hue, and color temperature use normalized
values from 0 through 100. Gamma uses the product range 0.5 through 2.8 accepted
by the native protocol. Every color setting is optional; an omitted field means
that target does not override that capability and the display keeps its captured
pre-ChromaShift baseline. A target whose `color` is empty issues no native write.
Each target may also persist `lastColorValues`, which remembers the most recent
number for an inactive control without making it an applied override. This keeps
the optional-setting contract intact while allowing disable and re-enable to
restore the user's prior value across application restarts.

There is exactly one source of applied settings per `(profileId, displayId)`
pair; no shared profile-level color object remains. `packages/core` exports
`resolveDisplayColor`, `activeColorTargets`, `findDisplayTarget`,
`setDisplayTarget`, and `removeDisplayTarget` so every layer resolves targets
through the same case-insensitive rules.

For an application profile, presence in `displays` means the display is assigned
to that profile. For the Default profile, the renderer enumerates all connected
displays and joins any persisted target by stable ID; a connected display with no
persisted target stays at baseline, so a newly connected display receives no
overrides automatically.

Zod validates the complete persisted document. Profile IDs and display targets
must be unique case-insensitively, and a configured default must reference an
existing profile. Unknown fields are rejected so vendor-native values cannot
silently enter the product model.

`JsonProfileRepository` owns validation, serialization, CRUD, duplication, and
default-profile maintenance. Its small `ProfileConfigurationStorage` interface
keeps the app-data filesystem decision in Electron main while allowing the
repository to be tested without filesystem state. Returned objects are cloned
so callers cannot mutate repository state without a successful save, and
duplication deep-copies every target's settings and remembered values.

Two explicit migrations run on load. Version 0 moves the former top-level
`defaultProfileId` into `settings`. Version 1 copies each profile's shared
`color` and `lastColorValues` into every one of its existing display targets,
preserving profile IDs, names, enabled state, application rules, target order,
and stable display IDs. A version 1 profile holding color values but targeting no
display never reached the hardware and has no version 2 home, so migration
discards those values and reports a `discardedUnassignedColorSettings` notice
through `onMigrationNotice` rather than inventing a display target. Loading
legacy JSON rewrites it at the current version. Invalid or unknown versions fail
explicitly and are never replaced with an empty configuration.

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

The resolver remains synchronous and does not call the native service. Electron
main's Milestone 2 activation coordinator now serializes events around it and
performs baseline-aware native apply and restore operations.
