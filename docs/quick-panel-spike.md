# Windows non-activating quick-panel spike

Status: successful behavior prototype; production dismissal behavior remains a
separate decision.

## Question

Can ChromaShift keep the current game or application in the foreground while a
user clicks and operates the Electron quick panel?

## Result

Yes. The existing Electron renderer can remain in use. On Windows, creating the
quick-panel `BrowserWindow` with `focusable: false` and showing it with
`showInactive()` gives the required non-activating behavior.

Electron 43.3.0 implements `setFocusable(false)` by setting
`WS_EX_NOACTIVATE`, disabling widget activation, skipping the taskbar, and
removing focus. See Electron's
[`NativeWindowViews::SetFocusable`](https://github.com/electron/electron/blob/v43.3.0/shell/browser/native_window_views.cc#L1440-L1452).
Microsoft documents that a top-level window created with
[`WS_EX_NOACTIVATE`](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles#ws_ex_noactivate)
does not become the foreground window when clicked.

The spike's Win32 smoke test verified all of the following on Windows 11 at
125% display scaling:

- the foreground probe HWND was unchanged when the panel appeared
- the panel HWND contained `WS_EX_NOACTIVATE`
- a real Win32 pointer click reached an interactive React control
- the pointer click did not make ChromaShift the foreground window
- a subsequent key press still reached the original foreground window

Run the repeatable check with:

```powershell
npm run smoke:quick-panel
```

The test uses a small WinForms foreground probe, Win32 pointer input, the actual
Electron window, and the actual renderer. It does not substitute a DOM click for
the OS interaction being tested.

## C# helper conclusion

Do not add a `configureWindow(hwnd, { noActivate: true })` command to
`DisplayService` for this behavior. Electron already owns the HWND and applies
the required native style in-process.

The proposed helper-owned `WM_MOUSEACTIVATE` override is also the wrong process
boundary. Microsoft says a window receives
[`WM_MOUSEACTIVATE`](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-mouseactivate)
through its window procedure, and advises applications not to subclass a window
class created by another process in the
[`SetWindowLongPtr` documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowlongptrw#remarks).
If message-level handling is ever required, it must stay in the Electron-owned
window process or move to a native process that owns the panel itself.

## Constraints discovered

### Click-away dismissal

A non-activating panel never owns focus, so Electron's `blur` event cannot be
used as its click-away signal. This spike therefore removes blur dismissal on
Windows. Opening the app panel and clicking the tray icon again still hide the
quick panel.

Exact Windows-style outside-click dismissal needs a follow-up decision. The
available approaches are:

1. Add a narrowly scoped native outside-pointer observer that runs only while
   the panel is visible. This preserves the Electron UI but introduces global
   mouse observation that must be reviewed for privacy, performance, and game
   compatibility.
2. Move the quick panel into a native-owned popup so it can use native popup or
   mouse-capture semantics. This is substantially more implementation and UI
   duplication than the focus problem requires.
3. Keep explicit dismissal for the first production slice: tray toggle, opening
   the app panel, choosing an action that closes it, or an optional configured
   shortcut.

Do not simulate click-away by restoring focus after ChromaShift takes it. The
panel should never activate in the first place.

### Tray and notification-area behavior

The panel HWND can preserve foreground, but ChromaShift does not control the
Windows notification area. On the spike machine, opening Windows' hidden-icons
overflow made `explorer.exe` the foreground process before ChromaShift was
clicked. A directly visible ChromaShift tray icon and a user-configurable global
shortcut should both be tested as entry paths. The shortcut is the only entry
path ChromaShift can guarantee never passes through the Windows shell.

### Keyboard and accessibility

The quick panel is intentionally pointer-oriented. A `WS_EX_NOACTIVATE` window
does not receive ordinary keyboard navigation, and Microsoft cautions against
activating it through accessibility keyboard navigation. Text entry, full
keyboard operation, and the complete accessible workflow remain in the normal
app panel. The quick panel must not become the only path to any feature.

### Full-screen behavior

The spike covers normal desktop windows. Borderless-fullscreen and exclusive-
fullscreen games still require real-game verification. Ordinary always-on-top
windows may not appear over exclusive fullscreen surfaces.

## Recommendation

Adopt the non-activating Electron window as the production direction. It solves
the original focus-stealing problem without a native UI rewrite or a new native
protocol command. Treat exact outside-click dismissal and tray-overflow behavior
as the next bounded slice, with the native outside-pointer observer evaluated
only if explicit dismissal is not sufficient in hands-on use.
