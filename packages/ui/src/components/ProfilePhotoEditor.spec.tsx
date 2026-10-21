import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
vi.mock('./compress-profile-photo.js', () => ({
  profilePhotoBase64: vi.fn(async () => 'compressed-jpeg'),
}));
const photo = { url: null, expiresAt: null, canUpload: true, notice: null };
describe('profile photo editor', () => {
  it('stages a creation photo without claiming it was saved remotely', async () => {
    const select = vi.fn();
    render(<ProfilePhotoEditor staged photo={photo} loading={false} onRefresh={vi.fn()} onUpload={select} />);
    await userEvent.upload(screen.getByLabelText('Choose profile photo'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    expect(select).toHaveBeenCalledWith('compressed-jpeg');
    expect(screen.getByText('Profile photo selected. It will be saved when the account is created.')).toBeInTheDocument();
    expect(screen.queryByText('Profile photo saved.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh photo' })).not.toBeInTheDocument();
  });
  it('compresses before saving and allows same-file replacement after completion', async () => {
    const save = vi.fn(async () => photo),
      user = userEvent.setup();
    render(
      <ProfilePhotoEditor photo={photo} loading={false} onRefresh={vi.fn()} onUpload={save} />,
    );
    const input = screen.getByLabelText('Choose profile photo'),
      file = new File(['x'], 'p.png', { type: 'image/png' });
    await user.upload(input, file);
    expect(save).toHaveBeenCalledWith('compressed-jpeg');
    expect(await screen.findByText('Profile photo saved.')).toBeInTheDocument();
    await user.upload(input, file);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('disables upload during account verification but leaves refresh available', () => {
    render(
      <ProfilePhotoEditor
        photo={{ ...photo, canUpload: false }}
        loading={false}
        onRefresh={vi.fn()}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Choose profile photo')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh photo' })).toBeEnabled();
  });
  it('provides retry after load failure without blocking the surrounding account page', async () => {
    const refresh = vi.fn();
    render(
      <ProfilePhotoEditor
        loading={false}
        error="Photos unavailable"
        onRefresh={refresh}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Photos unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh photo' }));
    expect(refresh).toHaveBeenCalled();
  });
});
