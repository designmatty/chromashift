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
user explicitly resumes control or selects an activation target or mode.
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
A one-shot restoration of Original settings that does not Pause display control
or change the Intended target.
_Avoid_: Pause, reset displays

## Activation

**Activation source**:
The user-facing category that initiated a completed profile transition:
Automatic, Manual, or Shortcut.
_Avoid_: Activation reason, trigger

**Intended target**:
The profile or Original settings selected by activation precedence, including
while display control is Paused and nothing is being applied.
_Avoid_: Active profile, applied profile
