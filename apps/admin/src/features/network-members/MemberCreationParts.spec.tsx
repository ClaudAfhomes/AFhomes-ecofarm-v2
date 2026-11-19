import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MemberIdentityDocument } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { CreationSection, MemberIdUpload } from './MemberCreationParts';
function Upload() {
  const [value, setValue] = useState<MemberIdentityDocument>();
  return (
    <>
      <MemberIdUpload value={value} onChange={setValue} />
      <output>{value?.mimeType ?? 'No ID'}</output>
    </>
  );
}
describe('consistent member intake', () => {
  it('shows identification fields directly without an accordion', () => {
    renderWithProviders(
      <CreationSection title="Identification"><p>Private ID fields</p></CreationSection>,
    );
    expect(screen.getByRole('group', { name: 'Identification' })).toBeVisible();
    expect(screen.getByText('Private ID fields')).toBeVisible();
    expect(document.querySelector('details, summary')).toBeNull();
  });
  it('stages a selected document, then clears it on an invalid replacement', async () => {
    renderWithProviders(<Upload />);
    const input = screen.getByLabelText('Government ID upload *');
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.7 synthetic'], 'id.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByText('Ready to upload: id.pdf');
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    fireEvent.change(input, {
      target: { files: [new File(['unsafe file'], 'id.svg', { type: 'image/svg+xml' })] },
    });
    await screen.findByRole('alert');
    expect(screen.getByText('No ID')).toBeInTheDocument();
    expect(screen.queryByText('Ready to upload: id.pdf')).toBeNull();
  });
  it('rejects an oversized ID before reading its contents', async () => {
    renderWithProviders(<Upload />);
    const file = new File(['%PDF-1.7'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 2097153 });
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    fireEvent.change(screen.getByLabelText('Government ID upload *'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('up to 2 MB'));
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});
