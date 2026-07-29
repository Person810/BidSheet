/**
 * First real component test in the repo.
 *
 * Two jobs. It pins ConfirmDialog's current behaviour ahead of the P2 work
 * (adding a `confirmText` type-to-confirm prop, which H02/H09 need), and it
 * proves the jsdom + @testing-library wiring actually renders — before this
 * file the only .test.tsx in the tree tested a pure function and would have
 * passed under the node environment too, so the DOM half of the setup was
 * unverified.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

function setup(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onYes = vi.fn();
  const onNo = vi.fn();
  render(<ConfirmDialog message="Delete this job?" onYes={onYes} onNo={onNo} {...overrides} />);
  return { onYes, onNo, user: userEvent.setup() };
}

describe('ConfirmDialog', () => {
  it('renders the message and both actions', () => {
    setup();
    expect(screen.getByText('Delete this job?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('uses the supplied confirm label', () => {
    setup({ yesLabel: 'Remove' });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('calls onYes only when the confirm button is pressed', async () => {
    const { onYes, onNo, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).not.toHaveBeenCalled();
  });

  it('calls onNo from Cancel', async () => {
    const { onYes, onNo, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onNo).toHaveBeenCalledTimes(1);
    expect(onYes).not.toHaveBeenCalled();
  });

  it('does not dismiss when the dialog body itself is clicked', async () => {
    // modalDismiss exists precisely so a stray click inside the dialog can't
    // discard the decision. Pinning it here because H06 turns on the difference
    // between a real pointer click (correctly ignored) and the synthetic click
    // the global Escape handler fires (currently NOT ignored).
    const { onNo, user } = setup();
    await user.click(screen.getByRole('dialog'));
    expect(onNo).not.toHaveBeenCalled();
  });

  it('exposes the dialog to assistive tech', () => {
    // Deliberately asserts only what ConfirmDialog does TODAY. It has role and
    // aria-label; it does not set aria-modal, trap focus, or restore focus on
    // close — that is H16/P4, repo-wide (zero aria-modal across 44 overlays).
    // When useModal lands, extend this test rather than writing a new one.
    const dialog = screen.queryByRole('dialog');
    expect(dialog).toBeNull();
    setup();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Confirm');
  });
});
