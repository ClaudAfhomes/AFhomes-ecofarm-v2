import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AfHomesDepartmentsPage } from './AfHomesDepartmentsPage';
import { renderWithProviders } from '../../test/utils';

vi.mock('./services', () => ({
  getAfHomesDepartments: vi.fn(),
  createAfHomesDepartment: vi.fn(),
  updateAfHomesDepartment: vi.fn(),
  deleteAfHomesDepartment: vi.fn(),
}));

const { getAfHomesDepartments, createAfHomesDepartment, updateAfHomesDepartment, deleteAfHomesDepartment } =
  await import('./services');

const EXECUTIVE = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'EXECUTIVE',
  name: 'Executive',
  isActive: true,
  staffCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};
const LEGACY = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'LEGACY',
  name: 'Legacy Unit',
  isActive: false,
  staffCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function show(rows = [EXECUTIVE, LEGACY]) {
  vi.mocked(getAfHomesDepartments).mockResolvedValue(rows);
  vi.mocked(createAfHomesDepartment).mockReset();
  vi.mocked(updateAfHomesDepartment).mockReset();
  vi.mocked(deleteAfHomesDepartment).mockReset();
  renderWithProviders(<AfHomesDepartmentsPage />);
}

describe('Departments table', () => {
  it('shows Department Name and Staff only, never ID or Code', async () => {
    show();
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Department Name', 'Staff', 'Actions']);
    expect(screen.queryByText('EXECUTIVE')).toBeNull();
    expect(screen.queryByText('Code')).toBeNull();
    expect(screen.queryByText('ID')).toBeNull();
    expect(await screen.findByText('Executive')).toBeInTheDocument();
    expect(screen.queryByText(EXECUTIVE.id)).toBeNull();
  });

  it('creates a department with a name only', async () => {
    show();
    await screen.findByText('Executive');
    vi.mocked(createAfHomesDepartment).mockResolvedValue({
      ...EXECUTIVE,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Finance',
    });
    fireEvent.click(screen.getByRole('button', { name: 'New department' }));
    expect(screen.queryByLabelText('Code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Department Name'), { target: { value: 'Finance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createAfHomesDepartment).toHaveBeenCalledWith({ name: 'Finance' }),
    );
  });

  it('edits the department name in place', async () => {
    show();
    await screen.findByText('Executive');
    const rows = screen.getAllByRole('row');
    const executiveRow = rows.find((r) => within(r).queryByText('Executive'))!;
    fireEvent.click(within(executiveRow).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Department Name')).toHaveValue('Executive');
    vi.mocked(updateAfHomesDepartment).mockResolvedValue({ ...EXECUTIVE, name: 'Head Office' });
    fireEvent.change(screen.getByLabelText('Department Name'), {
      target: { value: 'Head Office' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateAfHomesDepartment).toHaveBeenCalledWith(EXECUTIVE.id, {
        name: 'Head Office',
      }),
    );
  });

  it('disables Delete while staff are assigned, deletes otherwise', async () => {
    show();
    await screen.findByText('Executive');
    const rows = screen.getAllByRole('row');
    const executiveRow = rows.find((r) => within(r).queryByText('Executive'))!;
    const legacyRow = rows.find((r) => within(r).queryByText('Legacy Unit'))!;
    expect(within(executiveRow).getByRole('button', { name: 'Delete' })).toBeDisabled();
    const deleteButton = within(legacyRow).getByRole('button', { name: 'Delete' });
    expect(deleteButton).toBeEnabled();
    vi.mocked(deleteAfHomesDepartment).mockResolvedValue({ deleted: true as const });
    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole('button', { name: 'Delete department' }));
    await waitFor(() => expect(deleteAfHomesDepartment).toHaveBeenCalledWith(LEGACY.id));
  });
});
