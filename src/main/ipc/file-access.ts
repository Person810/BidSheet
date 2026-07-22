import { app } from 'electron';
import path from 'path';

/**
 * Access policy for renderer-supplied file paths.
 *
 * Paths the user picked through a native open dialog are recorded here by
 * the dialog handlers; a granted path may be read outright.
 *
 * Ungranted paths are still a legitimate flow — drag-and-drop (the preload
 * resolves dropped Files via webUtils.getPathForFile, with no main-process
 * registration of the drop) and a takeoff pdf_path stored by an earlier
 * session — and can't be told apart from a compromised renderer probing the
 * disk. Note that path.resolve() does NOT constrain where a path points, so
 * those reads keep working but are refused inside locations that hold
 * credentials or the app's own data.
 */

const grantedPaths = new Set<string>();

/** Record paths the user just chose in a native open dialog. */
export function grantPathAccess(...filePaths: string[]): void {
  for (const p of filePaths) grantedPaths.add(path.resolve(p));
}

function isGrantedPath(filePath: string): boolean {
  return grantedPaths.has(path.resolve(filePath));
}

/** Credential stores and the app's own data dir (DB, cloud auth tokens). */
function isSensitivePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const within = (dir: string) => resolved === dir || resolved.startsWith(dir + path.sep);
  if (within(path.resolve(app.getPath('userData')))) return true;
  const home = app.getPath('home');
  for (const name of ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.netrc']) {
    if (within(path.join(home, name))) return true;
  }
  return false;
}

/**
 * Gate for read handlers that accept a renderer-supplied path: a dialog
 * grant passes outright; anything else must be outside sensitive locations.
 */
export function isPathReadable(filePath: string): boolean {
  return isGrantedPath(filePath) || !isSensitivePath(filePath);
}
