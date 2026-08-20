# Physical display identity

ChromaShift separates a physical panel from the Windows/GPU endpoint used to
control it.

- An **endpoint ID** identifies one active connector path. It includes the EDID
  product code so DP and HDMI remain independently addressable by the native
  service.
- A **physical ID** identifies the panel for profiles and normal UI. It is
  derived from normalized EDID manufacturer plus a non-placeholder serial.
- If the serial is absent or looks generic, the endpoint ID is also used as the
  physical ID. ChromaShift prefers duplicate rows over merging unrelated panels.

The native service always captures, applies, validates, and restores by endpoint
ID. Electron groups active endpoints by physical ID. A profile target fans out
to every current endpoint in that group, while each endpoint retains its own
immutable baseline. The product capability report is the safe intersection of
the endpoint reports, so a setting is offered only when every current endpoint
can honor it.

At startup, an idempotent one-time rewrite maps profile targets using a current
endpoint ID to the corresponding physical ID. If connector-specific targets
collapse onto one physical target, an already-physical target wins; otherwise
the first persisted target wins and the conflict is logged. Unknown disconnected
targets remain persisted and hidden.

## Verified hardware

On 2026-08-14 the Odyssey G60SD exposed two simultaneous endpoints:

- DP endpoint: `display:355f1efb6477b78b6c7a15fa935aacccb7afd198994c72ace7349f9dc5ef3fcf`
- HDMI endpoint: `display:b361c05e6dea55c2141cae01b55b5cf220158a717afb90612a60a15add79c3b7`
- Shared physical ID: `display:4b518baf6fd688294cc0ddb625742692dfcb5cd16422ae9e80a565902d150c10`

DP reported product code `75CB`, HDMI reported `75C2`, and both reported serial
`HNAY301023`. The real desktop smoke selected this two-endpoint group, confirmed
that one profile write reached both paths, and independently confirmed exact
baseline restoration on both paths after normal exit and forced Electron
termination.
