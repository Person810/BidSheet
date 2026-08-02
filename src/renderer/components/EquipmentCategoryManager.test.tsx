/**
 * Component tests for the equipment category manager (#107).
 *
 * The backend rules are pinned in main/ipc/equipment-categories.test.ts
 * against a real SQLite database. What can only break up here is the wiring:
 * which payload each button sends, what stays disabled until a choice is
 * made, and whether the parent gets told about a rename or a delete so its
 * own state can follow. Those are exactly the things a click-through would
 * catch, so they are tested by clicking.
 *
 * window.api is a fake rather than the real IPC bridge — a component test
 * has no main process — but every payload it receives is asserted, so a
 * change to the contract fails here instead of silently at runtime.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipmentCategoryManager } from './EquipmentCategoryManager';
import type { EquipmentCategoryManagementRow } from '../../shared/types/ipc';

type Api = Window['api'];

const ROWS: EquipmentCategoryManagementRow[] = [
  { name: 'Excavator', equipmentCount: 2, activeEquipmentCount: 2, listed: true },
  { name: 'Hydro Excavation', equipmentCount: 1, activeEquipmentCount: 0, listed: false },
  { name: 'Plow', equipmentCount: 0, activeEquipmentCount: 0, listed: true },
];

let api: {
  getEquipmentCategoryManagement: ReturnType<typeof vi.fn>;
  saveEquipmentCategory: ReturnType<typeof vi.fn>;
  deleteEquipmentCategory: ReturnType<typeof vi.fn>;
  clearUnusedEquipmentCategories: ReturnType<typeof vi.fn>;
  adoptUsedEquipmentCategories: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  api = {
    getEquipmentCategoryManagement: vi.fn().mockResolvedValue(ROWS),
    saveEquipmentCategory: vi.fn().mockResolvedValue({ categories: [], equipmentUpdated: 0 }),
    deleteEquipmentCategory: vi.fn().mockResolvedValue({
      deletedName: '', replacementName: null, reassignedEquipmentCount: 0, categories: [],
    }),
    clearUnusedEquipmentCategories: vi.fn().mockResolvedValue({ removed: 0, categories: [] }),
    adoptUsedEquipmentCategories: vi.fn().mockResolvedValue({ added: 0, categories: [] }),
  };
  (globalThis as unknown as { window: Window }).window.api = api as unknown as Api;
});

function setup(open = true) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const onCategoryRenamed = vi.fn();
  const onCategoryDeleted = vi.fn();
  render(
    <EquipmentCategoryManager
      open={open}
      onClose={onClose}
      onChanged={onChanged}
      onCategoryRenamed={onCategoryRenamed}
      onCategoryDeleted={onCategoryDeleted}
    />
  );
  return { onClose, onChanged, onCategoryRenamed, onCategoryDeleted, user: userEvent.setup() };
}

/** The <tr> for a category, so assertions can't match text elsewhere. */
async function rowFor(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);
  return cell.closest('tr') as HTMLElement;
}

/**
 * Open the delete confirmation for a category and return the panel.
 *
 * Scoped rather than global because the row keeps its own "Delete" button
 * while the confirmation is up — a bare getByRole('button', {name:'Delete'})
 * matches both and the test would be asserting on whichever came first.
 */
async function openDelete(
  user: ReturnType<typeof userEvent.setup>,
  name: string
): Promise<HTMLElement> {
  const row = await rowFor(name);
  await user.click(within(row).getByRole('button', { name: 'Delete' }));
  return screen.getByText(`Delete "${name}"?`).closest('div') as HTMLElement;
}

describe('EquipmentCategoryManager rendering', () => {
  it('renders nothing when closed, and does not even ask for the list', () => {
    setup(false);
    expect(screen.queryByText('Manage Equipment Categories')).toBeNull();
    expect(api.getEquipmentCategoryManagement).not.toHaveBeenCalled();
  });

  it('lists every category with its equipment count', async () => {
    setup();
    const row = await rowFor('Excavator');
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('marks a category that only equipment keeps alive', async () => {
    // "Hydro Excavation" is in use but off the managed list — the badge is
    // what tells the user why they cannot simply not see it.
    setup();
    const row = await rowFor('Hydro Excavation');
    expect(within(row).getByText('in use')).toBeInTheDocument();
  });

  it('breaks out archived equipment in the count', async () => {
    setup();
    const row = await rowFor('Hydro Excavation');
    expect(within(row).getByText('(1 archived)')).toBeInTheDocument();
  });
});

describe('adding a category', () => {
  it('sends the typed name with no previousName', async () => {
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole('button', { name: '+ Add Category' }));
    await user.type(screen.getByLabelText('Name'), 'Vac Truck');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(api.saveEquipmentCategory).toHaveBeenCalledWith({
      name: 'Vac Truck',
      previousName: null,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('refuses a duplicate before it reaches the backend', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: '+ Add Category' }));
    await user.type(screen.getByLabelText('Name'), 'excavator');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('A category with this name already exists.')).toBeInTheDocument();
    expect(api.saveEquipmentCategory).not.toHaveBeenCalled();
  });

  it('checks against in-use categories too, not just the managed list', async () => {
    // Colliding with an unlisted-but-in-use name would silently merge two
    // categories that look separate in this very table.
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: '+ Add Category' }));
    await user.type(screen.getByLabelText('Name'), 'hydro excavation');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('A category with this name already exists.')).toBeInTheDocument();
    expect(api.saveEquipmentCategory).not.toHaveBeenCalled();
  });
});

describe('renaming a category', () => {
  it('prefills the old name, sends it as previousName, and tells the parent', async () => {
    const { user, onCategoryRenamed } = setup();
    const row = await rowFor('Excavator');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));

    const field = screen.getByLabelText('Name');
    expect(field).toHaveValue('Excavator');

    await user.clear(field);
    await user.type(field, 'Excavators');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.saveEquipmentCategory).toHaveBeenCalledWith({
      name: 'Excavators',
      previousName: 'Excavator',
    });
    // The page filters equipment by category *name*, so it has to be told.
    expect(onCategoryRenamed).toHaveBeenCalledWith('Excavator', 'Excavators');
  });

  it('allows a pure case change of the same name', async () => {
    const { user } = setup();
    const row = await rowFor('Excavator');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'EXCAVATOR');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.saveEquipmentCategory).toHaveBeenCalled();
    expect(screen.queryByText('A category with this name already exists.')).toBeNull();
  });

  it('surfaces a backend rejection instead of pretending it saved', async () => {
    api.saveEquipmentCategory.mockRejectedValueOnce(new Error('That category no longer exists.'));
    const { user, onChanged } = setup();
    const row = await rowFor('Excavator');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Diggers');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That category no longer exists.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('deleting a category', () => {
  it('deletes an empty one without asking for a replacement', async () => {
    const { user, onCategoryDeleted } = setup();
    const panel = await openDelete(user, 'Plow');

    expect(within(panel).getByText(/No equipment uses this category/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Delete' }));

    expect(api.deleteEquipmentCategory).toHaveBeenCalledWith({
      name: 'Plow',
      replacementName: null,
      expectedEquipmentCount: 0,
    });
    expect(onCategoryDeleted).toHaveBeenCalledWith('Plow', null);
  });

  it('blocks the delete until a replacement is chosen', async () => {
    const { user } = setup();
    const panel = await openDelete(user, 'Excavator');

    const confirm = within(panel).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();

    await user.selectOptions(within(panel).getByRole('combobox'), 'Plow');
    expect(confirm).toBeEnabled();
  });

  it('sends the replacement and the count the user was shown', async () => {
    const { user, onCategoryDeleted } = setup();
    const panel = await openDelete(user, 'Excavator');
    await user.selectOptions(within(panel).getByRole('combobox'), 'Plow');
    await user.click(within(panel).getByRole('button', { name: 'Delete' }));

    expect(api.deleteEquipmentCategory).toHaveBeenCalledWith({
      name: 'Excavator',
      replacementName: 'Plow',
      // The stale-count guard is only worth anything if the UI actually
      // reports what it displayed rather than re-reading it.
      expectedEquipmentCount: 2,
    });
    expect(onCategoryDeleted).toHaveBeenCalledWith('Excavator', 'Plow');
  });

  it('never offers the category being deleted as its own replacement', async () => {
    const { user } = setup();
    const panel = await openDelete(user, 'Excavator');

    const options = within(within(panel).getByRole('combobox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).not.toContain('Excavator');
  });

  it('reloads and drops the dialog when the count moved underneath it', async () => {
    api.deleteEquipmentCategory.mockRejectedValueOnce(
      new Error('Equipment count has changed. Please refresh and try again.')
    );
    const { user } = setup();
    const panel = await openDelete(user, 'Plow');
    await user.click(within(panel).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/count has changed/)).toBeInTheDocument();
    // Re-read, so the user is looking at what is actually there now.
    expect(api.getEquipmentCategoryManagement).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/No equipment uses this category/)).toBeNull();
  });
});

describe('bulk actions', () => {
  it('offers to clear the categories nothing is using', async () => {
    // The blank-database case from #107: 15 defaults nobody asked for.
    const { user, onChanged } = setup();
    await user.click(await screen.findByRole('button', { name: /Remove 1 unused/ }));
    expect(api.clearUnusedEquipmentCategories).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers to adopt the in-use categories the list is missing', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /Keep 1 in use/ }));
    expect(api.adoptUsedEquipmentCategories).toHaveBeenCalled();
  });

  it('hides both when there is nothing to clear or adopt', async () => {
    api.getEquipmentCategoryManagement.mockResolvedValue([
      { name: 'Excavator', equipmentCount: 2, activeEquipmentCount: 2, listed: true },
    ]);
    setup();
    expect(await screen.findByText('Excavator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unused/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /in use/ })).toBeNull();
  });
});
