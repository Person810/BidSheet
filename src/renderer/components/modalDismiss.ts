import type { MouseEvent } from 'react';

/**
 * Backdrop-dismiss policy for every modal in the app (#109, #111).
 *
 * A stray click outside a dialog used to close it and throw the draft away
 * with no warning — losing a half-entered job, client, or line item. Dialogs
 * now close on their own Cancel/Close button and nothing else.
 *
 * This covers pickers and reports too, where a click-away costs no data. A
 * rule you have to reason about ("does this one lose my work?") is a rule
 * that surprises you; one that always holds is one you stop thinking about.
 *
 * Esc still gets you out: App.tsx's global handler closes the topmost dialog
 * by calling .click() on its overlay, and a synthetic click carries
 * `detail === 0` with `isTrusted === false` (no pointer behind it). That is
 * the only click this lets through.
 */
export function dismissOnEscOnly(onClose: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return; // bubbled up from inside the dialog
    if (e.detail !== 0 || e.nativeEvent.isTrusted) return; // a real click on the backdrop
    onClose();
  };
}
