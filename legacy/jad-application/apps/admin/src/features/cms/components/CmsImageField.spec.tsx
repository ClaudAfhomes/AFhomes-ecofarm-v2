import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CmsImageField } from './CmsImageField';

const basePhoto = { id: 'photo-1600585154340-be6161a56a0c', alt: 'A modern residence' };

describe('CmsImageField - production upload (Step 1)', () => {
  it('renders drop zone with preview and actions', () => {
    const onChange = vi.fn();
    render(<CmsImageField label="Hero image" value={basePhoto} onChange={onChange} />);
    expect(screen.getByTestId('image-dropzone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    // preview via Unsplash seed
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement;
    expect(img.src).toContain('images.unsplash.com');
    expect(screen.getByDisplayValue('A modern residence')).toBeInTheDocument();
    expect(screen.queryByLabelText('Image ID')).not.toBeInTheDocument();
    expect(screen.queryByText(/Unsplash photo ID/)).not.toBeInTheDocument();
  });

  it('shows empty state when no image', () => {
    const onChange = vi.fn();
    render(<CmsImageField label="Hero image" value={{ id: '', alt: '' }} onChange={onChange} />);
    expect(screen.getByText('No image: upload to publish')).toBeInTheDocument();
    expect(screen.getByText(/Drag and drop an image here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('upload via file chooser shows preview and calls onChange with public URL on success', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // mock URL.createObjectURL and fetch for signed URL flow
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/cms/upload/sign')) {
        return new Response(
          JSON.stringify({
            signedUrl: 'https://example.com/signed',
            publicUrl: 'https://example.com/uploaded.jpg',
            path: 'cms/test.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === 'https://example.com/signed') {
        return new Response('', { status: 200 });
      }
      return new Response('', { status: 200 });
    });
    global.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 1600;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    } as unknown as typeof Image;

    render(<CmsImageField label="Hero image" value={basePhoto} onChange={onChange} />);
    const file = new File(['dummy'], 'test.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alt: 'A modern residence' }));
    const arg = onChange.mock.calls[0]![0] as { id: string };
    expect(arg.id).toBe('https://example.com/uploaded.jpg');

    createObjectURLSpy.mockRestore();
    revokeSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('drag-and-drop uploads file', async () => {
    const onChange = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:drag-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/cms/upload/sign')) {
        return new Response(
          JSON.stringify({
            signedUrl: 'https://example.com/signed-drag',
            publicUrl: 'https://example.com/drag.jpg',
            path: 'cms/drag.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === 'https://example.com/signed-drag') {
        return new Response('', { status: 200 });
      }
      return new Response('', { status: 200 });
    });
    global.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 1600;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    } as unknown as typeof Image;

    render(<CmsImageField label="Hero image" value={basePhoto} onChange={onChange} />);
    const dropZone = screen.getByTestId('image-dropzone');
    const file = new File(['dummy'], 'drop.png', { type: 'image/png' });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.dragEnter(dropZone, {
      dataTransfer: { files: [file], types: ['Files'] },
    } as unknown as DragEvent);
    fireEvent.dragOver(dropZone, {
      dataTransfer: { files: [file], types: ['Files'] },
    } as unknown as DragEvent);
    expect(dropZone.className).toMatch(/previewWrapOver|dropZoneOver/);

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], types: ['Files'] },
    } as unknown as DragEvent);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'https://example.com/drag.jpg' }),
    );

    vi.restoreAllMocks();
  });

  it('Remove clears image and calls onChange with empty id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CmsImageField label="Hero image" value={basePhoto} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith({ id: '', alt: '' });
  });

  it('rejects non-image file types', async () => {
    const onChange = vi.fn();
    render(<CmsImageField label="Hero image" value={basePhoto} onChange={onChange} />);
    const file = new File(['dummy'], 'doc.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Only JPG, PNG and WebP/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is keyboard accessible (Replace button opens chooser)', async () => {
    const user = userEvent.setup();
    render(<CmsImageField label="Hero image" value={basePhoto} onChange={vi.fn()} />);
    const replaceButton = screen.getByRole('button', { name: 'Replace' });
    replaceButton.focus();
    expect(replaceButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(replaceButton).toBeInTheDocument();
  });
});
