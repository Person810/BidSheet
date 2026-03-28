/**
 * Structured logger for BidSheet.
 *
 * Writes JSON-lines to %APPDATA%/BidSheet/logs/bidsheet-YYYY-MM-DD.log
 * Each line: { ts, level, op, msg, detail? }
 *
 * Log files rotate daily by filename. Old logs are NOT auto-deleted;
 * they're small (text-only, no binary) and useful for field debugging.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  op: string;
  msg: string;
  detail?: string;
}

let logDir: string = '';
let logStream: fs.WriteStream | null = null;
let currentDateStr: string = '';

function dateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureStream(): fs.WriteStream | null {
  const today = dateStr();

  // First call or day rolled over
  if (today !== currentDateStr || !logStream) {
    // Close yesterday's stream
    if (logStream) {
      try { logStream.end(); } catch (_) { /* swallow */ }
    }

    if (!logDir) {
      logDir = path.join(app.getPath('userData'), 'logs');
    }

    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch (_) {
      // Can't create log dir -- degrade silently
      return null;
    }

    const filePath = path.join(logDir, `bidsheet-${today}.log`);
    try {
      logStream = fs.createWriteStream(filePath, { flags: 'a' });
      currentDateStr = today;
    } catch (_) {
      logStream = null;
      return null;
    }
  }

  return logStream;
}

function write(level: LogLevel, op: string, msg: string, detail?: string): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    op,
    msg,
  };
  if (detail) entry.detail = detail;

  // Always write to stdout in dev for convenience
  const line = JSON.stringify(entry);
  if (!app.isPackaged) {
    console.log(line);
  }

  const stream = ensureStream();
  if (stream) {
    stream.write(line + '\n');
  }
}

export const logger = {
  info: (op: string, msg: string) => write('info', op, msg),
  warn: (op: string, msg: string, detail?: string) => write('warn', op, msg, detail),
  error: (op: string, msg: string, detail?: string) => write('error', op, msg, detail),

  /** Returns the directory where logs are stored, for display in Settings etc. */
  getLogDir: (): string => {
    if (!logDir) {
      logDir = path.join(app.getPath('userData'), 'logs');
    }
    return logDir;
  },
};
