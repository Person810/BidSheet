import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MaterialCategoryManager } from './MaterialCategoryManager';
import type { MaterialCategoryManagementRow } from '../../shared/types/ipc';

const mockCategories: MaterialCategoryManagementRow[] = [
  { id: 1, name: 'Pipe', description: 'Pipe materials', is_active: 1, materialCount: 5 },
  { id: 2, name: 'Fittings', description: 'Fittings materials', is_active: 1, materialCount: 0 },
  { id: 3, name: 'Old Valves', description: 'Legacy category', is_active: 0, materialCount: 0 },
];

describe('MaterialCategoryManager Component', () => {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const onCategoryDeleted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).api = {
      getMaterialCategoryManagement: vi.fn().mockResolvedValue(mockCategories),
      saveMaterialCategory: vi.fn().mockResolvedValue({ id: 4, name: 'New Cat', is_active: 1 }),
      deleteMaterialCategory: vi.fn().mockResolvedValue({ success: true }),
      restoreMaterialCategory: vi.fn().mockResolvedValue({ id: 3, name: 'Old Valves', is_active: 1 }),
    };
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <MaterialCategoryManager open={false} onClose={onClose} onChanged={onChanged} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides inactive categories by default and shows them when toggle is checked', async () => {
    render(
      <MaterialCategoryManager open={true} onClose={onClose} onChanged={onChanged} />
    );

    await waitFor(() => {
      expect(screen.getByText('Manage Categories')).toBeInTheDocument();
      expect(screen.getByText('Pipe')).toBeInTheDocument();
      expect(screen.getByText('Fittings')).toBeInTheDocument();
      expect(screen.queryByText('Old Valves')).toBeNull();
    });

    const toggle = screen.getByLabelText(/Show hidden categories/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Old Valves')).toBeInTheDocument();
      expect(screen.getByText('hidden')).toBeInTheDocument();
    });
  });

  it('allows adding a new material category', async () => {
    render(
      <MaterialCategoryManager open={true} onClose={onClose} onChanged={onChanged} />
    );

    await waitFor(() => {
      expect(screen.getByText('+ Add Category')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Add Category'));
    const input = screen.getByLabelText(/Name/i);
    fireEvent.change(input, { target: { value: 'Track Ballast' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(window.api.saveMaterialCategory).toHaveBeenCalledWith({
        name: 'Track Ballast',
        description: null,
      });
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it('requires selecting a replacement category when deleting a populated category', async () => {
    render(
      <MaterialCategoryManager
        open={true}
        onClose={onClose}
        onChanged={onChanged}
        onCategoryDeleted={onCategoryDeleted}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Pipe')).toBeInTheDocument();
    });

    // Pipe has 5 materials (populated)
    const pipeRow = screen.getByText('Pipe').closest('tr')!;
    const deleteBtn = pipeRow.querySelector('.btn-danger')!;
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText(/Delete "Pipe"\?/i)).toBeInTheDocument();
      expect(screen.getByText(/This category has 5 materials/i)).toBeInTheDocument();
    });

    // Delete button should be disabled until replacement is selected
    const modalActions = screen.getByText(/Delete "Pipe"\?/i).parentElement!;
    const confirmBtn = modalActions.querySelector('.btn-primary') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '2' } }); // Select 'Fittings'

    expect(confirmBtn.disabled).toBe(false);
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(window.api.deleteMaterialCategory).toHaveBeenCalledWith({
        categoryId: 1,
        replacementCategoryId: 2,
        expectedMaterialCount: 5,
      });
      expect(onChanged).toHaveBeenCalled();
      expect(onCategoryDeleted).toHaveBeenCalledWith(1, 2);
    });
  });

  it('allows restoring a soft-deleted category', async () => {
    render(
      <MaterialCategoryManager open={true} onClose={onClose} onChanged={onChanged} />
    );

    await waitFor(() => {
      expect(screen.getByText('Pipe')).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText(/Show hidden categories/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Old Valves')).toBeInTheDocument();
    });

    const restoreBtn = screen.getByRole('button', { name: 'Restore' });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(window.api.restoreMaterialCategory).toHaveBeenCalledWith(3);
      expect(onChanged).toHaveBeenCalled();
    });
  });
});
