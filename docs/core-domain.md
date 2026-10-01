# Core domain

`packages/core` has no dependency on Electron, Node APIs, or GPU vendors. It owns
profile persistence, migration, matching, and activation selection.

## Profile configuration

The persisted root object has schema version 3:

```json
{
  "schemaVersion": 3,
  "profiles": [],
  "settings": { "defaultProfileId": null }
}
```

A profile contains application rules and display targets keyed by stable physical
display ID. Every assigned target owns the complete vendor-neutral color vector:

```json
{
  "id": "tarkov-night",
  "name": "Tarkov - Night",
  "enabled": true,
  "applications": [{ "executableName": "EscapeFromTarkov.exe" }],
  "displays": [
    {
      "displayId": "display:abc",
      "color": {
        "brightness": 84,
        "contrast": 50,
        "gamma": 1.15,
        "saturation": 65,
        "hue": 0,
        "colorTemperature": 50
      }
    }
  ]
}
```

The neutral color settings are brightness 50, contrast 50, gamma 1, saturation
50, hue 0, and color temperature 50. Brightness, contrast, saturation, hue, and
color temperature use values from 0 through 100. Gamma uses the physical product
range 0.3 through 2.8 and the brightness-dependent color safety envelope:

| Brightness | Gamma minimum | Gamma maximum |
| ---------- | ------------- | ------------- |
| 0-6        | 0.5           | 2.8           |
| 7-29       | 0.4           | 2.8           |
| 30-86      | 0.3           | 2.8           |
| 87-89      | 0.3           | 2.7           |
| 90-91      | 0.3           | 2.6           |
| 92-96      | 0.3           | 2.5           |
| 97-99      | 0.3           | 2.4           |
| 100        | 0.3           | 2.3           |

A missing display target means the display stays at its captured original state.
Individual settings cannot be omitted or disabled in persistence. Unsupported
values remain stored so user intent survives hardware changes; Electron filters
them only when constructing capability-aware native commands.

For an application profile, presence in `displays` assigns that display. The
permanent Default profile implicitly covers every connected display, but a
missing persisted target still leaves that display at its original settings.
Disconnected targets remain persisted and are omitted from the normal editor.

Zod validates the complete document and rejects unknown fields. Profile IDs and
display targets must be unique case-insensitively. `JsonProfileRepository` owns
validation, serialization, CRUD, duplication, and Default-profile maintenance.
Returned values are cloned so mutation requires a successful save.

## Migration

Loading older JSON rewrites it at schema version 3:

- Version 0 moves the top-level `defaultProfileId` into `settings`.
- Version 1 copies shared profile color values to every existing display target.
  Unassigned values are discarded with a structured diagnostic because they were
  never applied to a display.
- Version 2 fills every missing target field with its neutral value, discards
  `lastColorValues`, and clamps gamma to the safety envelope for that target's
  brightness.

Migration notices are written to structured diagnostics and are not shown in the
app. Invalid or unknown versions fail explicitly and are never replaced with an
empty configuration.

## Application matching

Application matching is Windows-case-insensitive and supports both slash forms.
Each rule stores an executable filename and may store a preferred full path.

- When both paths are known, only an exact normalized path matches.
- When either path is unavailable, executable filename is the fallback.
- Exact path matches outrank filename-only matches; ties preserve profile order.
- Disabled profiles never match.

## Activation

`selectActivation` implements this precedence:

```text
valid enabled manual override
  > foreground application profile
  > valid enabled Default profile
  > original settings
```

`ActivationResolver` reports only target transitions so the integration layer can
avoid duplicate writes. Electron serializes profile switching, preview, pause,
restore, and topology work, then restores the immutable captured baseline before
applying the newly selected complete desired state.
