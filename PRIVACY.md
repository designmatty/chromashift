# Privacy

The production ChromaShift app has no telemetry, analytics, or outbound network
requests. ChromaShift does not send profile data, display details, application
activity, diagnostics, or usage data to the maintainer or a third party.

## Data stored on this computer

ChromaShift stores its application data under `%APPDATA%\ChromaShift`:

- `profiles.json` contains profile names, display identifiers, color settings,
  and assigned application names and executable paths.
- `preferences.json` contains user preferences, notification settings, and
  shortcut bindings.
- `window-state.json` contains app-panel geometry and the mini-panel position.
- `chroma-shift.json` contains the display-control state and intended activation
  target.
- `logs/main.jsonl` contains rotated operational diagnostics. Entries may include
  display identifiers, foreground application names, paths and window titles,
  activation decisions, native-service status, and errors.

Electron and Windows may also create ordinary application cache, notification,
and runtime files in the application-data directory. Uninstalling ChromaShift
does not delete the data above. A user can remove it by deleting
`%APPDATA%\ChromaShift` after ChromaShift has exited.

Development and test commands may use package registries, GitHub, local debugging
ports, or explicit test services. Those tools are separate from the production
app described here.
