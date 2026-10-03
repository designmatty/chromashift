# Privacy

The production ChromaShift app has no telemetry or analytics.
ChromaShift does not send profile data, display details, application
activity, diagnostics, or usage data to the maintainer or a third party.

Choosing **Check for updates** sends a request to the public GitHub releases API.
GitHub receives your IP address and a user-agent containing the ChromaShift
version. The request contains no credentials or local product data. There are
no background update checks. When a newer version is available in an installed
release, ChromaShift automatically downloads its metadata and installer from
GitHub's release download service. GitHub and its download CDN receive ordinary
network request information. The installer stays in Electron's per-user updater
cache until you choose **Restart and install**. ChromaShift verifies the release
hash and Windows publisher signature, restores display settings, and installs
the update before reopening the app.

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

## Website

The `chromashift.io` website is separate from the app. It uses Cloudflare Web
Analytics for aggregate, cookie-free traffic and performance statistics. It sets
no cookies and uses no fingerprinting, custom events, or advertising pixels. To
link the newest installer, the page asks the public GitHub releases API for
release metadata directly from the visitor's browser.
