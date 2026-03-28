# BidSheet Error Handling and Logging

## Overview

BidSheet logs structured data to disk and shows plain-English error messages in the UI when something goes wrong. This system exists so that when a user hits a problem in the field, you can ask them to send their log file and get the full technical details without needing them to describe what happened.


## Log Files

Location: `%APPDATA%\BidSheet\logs\`

Typical path: `C:\Users\<username>\AppData\Roaming\bidsheet\logs\`

Files are named by date: `bidsheet-2026-03-28.log`

A new file is created each day automatically. Old logs are not deleted. They are plain text and stay small.

Each line is a JSON object with these fields:

- `ts` -- ISO 8601 timestamp
- `level` -- `info`, `warn`, or `error`
- `op` -- which operation or IPC channel triggered the entry (e.g. `db:labor-roles:save`, `csv:import`, `app`)
- `msg` -- the user-facing message (what showed in the toast)
- `detail` -- (errors only) the raw error message and stack trace

Example:

```
{"ts":"2026-03-28T03:53:15.030Z","level":"error","op":"db:labor-roles:save","msg":"This record conflicts with existing data. Check for duplicates.","detail":"SqliteError: UNIQUE constraint failed: labor_roles.name\n    at ipc-handlers.js:150:18\n    ..."}
```


## What Gets Logged

Info level:
- App startup and shutdown
- Database opened (includes path)
- CSV file parsed (row/column count)
- CSV price import results (updated/skipped counts)
- Setup wizard completed

Error level:
- Any IPC handler failure (all 35+ handlers are wrapped)
- Database initialization failure
- CSV parse/import failures
- Uncaught exceptions and unhandled promise rejections in the main process


## User-Facing Error Messages

When a database or filesystem error occurs, the raw error is translated to a plain-English message shown as a toast notification in the bottom-right corner of the app. The translations:

| Raw Error | User Sees |
|---|---|
| SQLITE_BUSY / database is locked | Database is busy. Try again in a moment. |
| SQLITE_CONSTRAINT / UNIQUE constraint | This record conflicts with existing data. Check for duplicates. |
| SQLITE_CORRUPT / disk image is malformed | Database file may be damaged. Try restoring from a backup. |
| SQLITE_READONLY | Database is read-only. Check file permissions or disk space. |
| SQLITE_FULL / disk is full | Disk is full. Free some space and try again. |
| ENOENT / no such file | File not found. It may have been moved or deleted. |
| EACCES / permission denied | Permission denied. Check that BidSheet has access to this file. |
| ENOSPC / no space left | Disk is full. Free some space and try again. |
| Anything else | Something went wrong. Check the log for details. |

Error toasts auto-dismiss after 8 seconds. Warning toasts after 6 seconds. Success/info after 4 seconds. All can be dismissed manually by clicking the X.


## How It Works (Architecture)

Three layers:

1. `src/main/logger.ts` -- writes JSON lines to the log directory. Uses a write stream with daily rotation by filename. In dev mode, also writes to stdout.

2. `src/main/ipc-handlers.ts` -- every IPC handler is registered through `safeHandle()` instead of `ipcMain.handle()`. This wrapper catches errors, runs them through `friendlyMessage()` for translation, logs the full error to disk, and re-throws with the friendly message. Electron serializes that back to the renderer as a rejected promise.

3. `src/renderer/App.tsx` -- a global `unhandledrejection` listener catches any IPC error that a page did not explicitly handle and shows it as a toast via the Zustand toast store. Pages that already do their own error handling (CSV import, backup/restore) continue working as before.

Process-level handlers in `src/main/main.ts` catch `uncaughtException` and `unhandledRejection` as a last resort, logging them and (for uncaught exceptions) showing a native OS error dialog.


## Adding Error Handling to New Code

For new IPC handlers, use `safeHandle` instead of `ipcMain.handle`:

```typescript
safeHandle('db:new-thing:save', (_event, data: any) => {
  return db.prepare('INSERT INTO new_table (name) VALUES (?)').run(data.name);
});
```

For new renderer pages, errors from `window.api` calls will be caught by the global handler automatically. If you want more specific messaging for a particular action, wrap the call in try/catch:

```typescript
try {
  await window.api.saveNewThing(data);
} catch (err: any) {
  addToast(err.message || 'Could not save.', 'error');
}
```


## Retrieving Logs from a User

Ask them to:
1. Open File Explorer
2. Type `%APPDATA%\BidSheet\logs` in the address bar and press Enter
3. Send the .log file(s) for the relevant date(s)

The Settings page exposes a `getLogDir()` API if you want to add a "View Logs" or "Copy Log Path" button later.


## Files Involved

- `src/main/logger.ts` -- logger module
- `src/main/main.ts` -- process-level error handlers, logger init
- `src/main/ipc-handlers.ts` -- safeHandle wrapper, friendlyMessage translator
- `src/renderer/stores/toast-store.ts` -- Zustand toast state
- `src/renderer/components/Toast.tsx` -- toast notification component
- `src/renderer/App.tsx` -- global unhandledrejection listener, ToastContainer mount
- `src/renderer/styles/global.css` -- toast-slide-in animation
