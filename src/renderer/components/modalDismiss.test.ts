import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { dismissOnEscOnly } from './modalDismiss';

/**
 * The whole point of the helper is telling a real backdrop click apart from
 * the synthetic one App.tsx fires for Esc, so that is what these cover.
 */
const overlay = {} as HTMLElement;

function click(
  handler: (e: any) => void,
  opts: { target?: unknown; detail: number; isTrusted: boolean }
) {
  handler({
    target: opts.target ?? overlay,
    currentTarget: overlay,
    detail: opts.detail,
    nativeEvent: { isTrusted: opts.isTrusted },
  });
}

describe('dismissOnEscOnly', () => {
  it('ignores a real mouse click on the backdrop', () => {
    const onClose = vi.fn();
    click(dismissOnEscOnly(onClose), { detail: 1, isTrusted: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes for the synthetic click behind Esc', () => {
    const onClose = vi.fn();
    click(dismissOnEscOnly(onClose), { detail: 0, isTrusted: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks that bubbled up from inside the dialog', () => {
    const onClose = vi.fn();
    click(dismissOnEscOnly(onClose), { target: {}, detail: 0, isTrusted: false });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a trusted click even if it reports no pointer detail', () => {
    const onClose = vi.fn();
    click(dismissOnEscOnly(onClose), { detail: 0, isTrusted: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** The overlay's opening tag: scan to the first `>` outside a JSX brace, so
 *  an arrow function in a handler doesn't end the tag early. */
function openingTag(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/**
 * The policy only holds if it holds everywhere — one modal left on a plain
 * onClick is the bug all over again, and it's invisible until someone
 * click-aways out of a half-typed form. Overlays with no onClick at all are
 * fine (the cloud sign-in/enrolment modals deliberately can't be dismissed).
 */
describe('modal backdrop policy', () => {
  it('routes every dismissible overlay through dismissOnEscOnly', () => {
    const root = path.resolve(process.cwd(), 'src/renderer');
    const offenders: string[] = [];

    for (const file of tsxFiles(root)) {
      const source = fs.readFileSync(file, 'utf8');
      const marker = /className="modal-overlay"/g;
      let match: RegExpExecArray | null;
      while ((match = marker.exec(source)) !== null) {
        const tag = openingTag(source, match.index);
        if (tag.includes('onClick') && !tag.includes('dismissOnEscOnly')) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${path.relative(root, file)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
