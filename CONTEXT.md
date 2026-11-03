# ChromaShift

ChromaShift manages vendor-neutral display profiles and safely coordinates when
those profiles may affect connected displays.

## Display control

**ChromaShift status**:
The user-facing summary of display control as Active, Paused, or Safety blocked.
It does not describe whether the ChromaShift process is running.
_Avoid_: Application status, process status

**Display control**:
ChromaShift's authority to apply profile settings or restore captured original
display settings.

**Active display control**:
The user-authorized state in which ChromaShift may resolve and apply profiles.
_Avoid_: Enabled, running

**Paused display control**:
A persisted, user-selected state entered only after captured original settings
have been restored, in which ChromaShift performs no profile writes until the
user explicitly resumes control. Selecting an activation target or mode updates
intent while display control stays Paused.
_Avoid_: Disabled, restored

**Safety block**:
A fail-closed state in which ChromaShift prevents display writes because safe
restoration, baseline ownership, or display identity cannot be confirmed. It is
not a user-selected pause.
_Avoid_: Paused, disabled

**Original settings**:
The display state captured before ChromaShift first modified a display during
the current control session.
_Avoid_: Factory defaults, default profile

**Restore original settings**:
An action that restores Original settings and enters Paused display control
after complete restoration. Paused persists until the user resumes; the Intended
target is preserved. This action is a no-op while Paused or Safety blocked;
the emergency shortcut still restores Original settings directly.
_Avoid_: Reset displays

**Color safety envelope**:
The brightness and gamma combinations ChromaShift accepts to reduce the risk of
unreadably dark or washed-out display output. It is a product guardrail, not a
hardware-independent visibility guarantee.
_Avoid_: Safe range, visibility guarantee

**Neutral color settings**:
ChromaShift's canonical color values for no intentional profile adjustment.
They are product values, not captured Original settings, provider defaults, or
the Default profile.
_Avoid_: Default values, Original settings, provider defaults

**Complete color vector**:
The six vendor-neutral color values owned by an assigned profile display target.
Every value is present even when the display cannot currently apply it.
_Avoid_: Enabled controls, supported settings

## Activation

**Activation source**:
The user-facing category that initiated a completed profile transition:
Automatic, Manual, or Shortcut.
_Avoid_: Activation reason, trigger

**Intended target**:
The profile or Original settings selected by activation precedence, including
while display control is Paused and nothing is being applied.
_Avoid_: Active profile, applied profile

## Preview

**Preview session**:
The explicit activation session that applies saved or unsaved profile values
from Original settings. During app-panel Preview or Edit, displays without a target are held
at Original settings; ending the session reapplies the prior activation target.
Its kind is Preview (started by clicking an app-panel profile),
Edit (the first change promotes Preview in place; changes remain unsaved until
Update profile), or Temporary override
(mini-panel quick changes, exists exactly while applied values diverge from
the saved profile).
_Avoid_: Live mode, draft mode

**Draft**:
The unsaved copy of a profile whose changes a Preview session applies. A dirty
draft differs from saved profile content, including its name, applications,
availability, or display values; reverting all edits makes it clean.
_Avoid_: Working copy, pending profile
