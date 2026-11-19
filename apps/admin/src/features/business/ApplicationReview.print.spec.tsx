import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { downloadFile } from '../../lib/download';
import { applicationPdf, printApplicationPages, renderApplicationPaper } from './application-print';
import { emptyHolder } from './official-forms-fields';
import { ApplicationReview } from './ApplicationReview';
import { draftReservationPaper, reservationPdf } from './reservation-print';

vi.mock('./reservation-print', () => ({ draftReservationPaper: vi.fn(), reservationPdf: vi.fn() }));

vi.mock('./application-print', () => ({
  renderApplicationPaper: vi.fn(),
  applicationPdf: vi.fn(),
  printApplicationPages: vi.fn(),
}));
vi.mock('../../lib/download', () => ({ downloadFile: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function renderReview(referenceLayout = false) {
  const submit = vi.fn((e) => e.preventDefault());
  renderWithProviders(
    <form onSubmit={submit}>
      <ApplicationReview
        referenceLayout={referenceLayout}
        validId={referenceLayout}
        primary={{ ...emptyHolder('PRIMARY'), firstName: 'MARIA' }}
        secondary={null}
        planName="Silver VIP"
        tier="SILVER"
        paymentScheme="spot_cash"
        idType="passport"
        idNumber="P1234"
        nodes={[]}
        meta={{
          svdStaffId: '',
          ssmStaffId: '',
          smStaffId: '',
          referrerStaffId: '',
          vipRecommenderName: 'ANA',
          recommenderContact: '+639171234567',
          recommenderEmail: 'ana@example.test',
          acknowledgedAt: '2026-11-07',
          referrerAaNumber: '',
          recommenderAaNumber: 'AAO26100003',
          recommenderStaffId: '',
        }}
        channels={['Referral']}
        consent={false}
        onEdit={vi.fn()}
      />
    </form>,
  );
  return submit;
}

it('previews and prints actual draft values without submitting, and downloads a PDF through the shared helper', async () => {
  const pages = ['data:image/jpeg;base64,/9j/2Q=='];
  const envelope = { filename: 'application.pdf', mime: 'application/pdf', content: 'JVBERi0=' };
  vi.mocked(renderApplicationPaper).mockResolvedValue(pages);
  vi.mocked(applicationPdf).mockReturnValue(envelope);
  vi.mocked(printApplicationPages).mockResolvedValue();
  const submit = renderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Print Application' }));
  const dialog = await screen.findByRole('dialog', { name: 'Customer Application print preview' });
  expect(within(dialog).getByRole('img')).toHaveAttribute('src', pages[0]);
  expect(printApplicationPages).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Print Application' }));
  await waitFor(() => expect(printApplicationPages).toHaveBeenCalledWith(pages));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(applicationPdf).toHaveBeenCalledWith(pages));
  expect(downloadFile).toHaveBeenCalledWith(envelope);
  expect(renderApplicationPaper).toHaveBeenLastCalledWith(
    expect.objectContaining({
      primary: expect.objectContaining({ firstName: 'MARIA' }),
      planName: 'Silver VIP',
      idNumber: 'P1234',
      recommender: 'ANA',
      recommenderAaNumber: 'AAO26100003',
      channels: ['Referral'],
      consent: false,
    }),
  );
  expect(submit).not.toHaveBeenCalled();
});

it('shows document generation failures and leaves the draft editable', async () => {
  vi.mocked(renderApplicationPaper).mockRejectedValue(new Error('Canvas unavailable'));
  const submit = renderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  expect(await screen.findByText('Canvas unavailable')).toBeVisible();
  expect(downloadFile).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Edit Customer personal information' })).toBeEnabled();
  expect(submit).not.toHaveBeenCalled();
});

it('downloads a preliminary RA from current holder and tier values without submitting', async () => {
  const envelope = {
    filename: 'AFhomes-SILVER-RA-Preview.pdf',
    mime: 'application/pdf',
    content: 'JVBERi0=',
  };
  vi.mocked(reservationPdf).mockResolvedValue(envelope);
  const submit = renderReview();
  fireEvent.click(screen.getByRole('button', { name: 'Download RA form' }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(envelope));
  expect(draftReservationPaper).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: 'MARIA' }),
    null,
    'SILVER',
    'spot_cash',
    undefined,
    undefined,
  );
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the V4 compact review summaries and document actions connected without submitting', async () => {
  const envelope = { filename: 'application.pdf', mime: 'application/pdf', content: 'JVBERi0=' };
  vi.mocked(renderApplicationPaper).mockResolvedValue(['data:image/jpeg;base64,/9j/2Q==']);
  vi.mocked(applicationPdf).mockReturnValue(envelope);
  const submit = renderReview(true);
  expect(screen.getAllByRole('region')).toHaveLength(6);
  expect(
    within(screen.getByRole('region', { name: 'Acquisition channel & certification' })).getByText(
      'Confirmed',
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(envelope));
  expect(submit).not.toHaveBeenCalled();
});
