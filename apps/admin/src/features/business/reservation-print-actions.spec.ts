import { expect, it, vi } from 'vitest';
import { renderPaperRows, printApplicationPages, applicationPdf } from './application-print';
import { draftReservationPaper, printReservation, reservationPdf } from './reservation-print';
import { emptyHolder } from './official-forms-fields';
vi.mock('./application-print', () => ({ renderPaperRows: vi.fn(async () => ['page']), printApplicationPages: vi.fn(async () => {}), applicationPdf: vi.fn() }));
it('uses identical A4 document pages for RA printing and download, including actual draft values', async () => {
 const data = draftReservationPaper({ ...emptyHolder('PRIMARY'), firstName: 'MARA' }, null, 'SILVER', 'spot_cash', undefined, { reservationNumber: 'PROPOSED-1', agreementDate: '2026-11-08' });
 await printReservation(data);
 expect(printApplicationPages).toHaveBeenCalledWith(['page'], 'AFhomes Reservation Agreement');
 expect(JSON.stringify(vi.mocked(renderPaperRows).mock.calls[0]?.[0])).toContain('PROPOSED-1');
 expect(JSON.stringify(vi.mocked(renderPaperRows).mock.calls[0]?.[0])).toContain('2026-11-08');
 await reservationPdf(data);
 expect(vi.mocked(renderPaperRows).mock.calls[0]).toEqual(vi.mocked(renderPaperRows).mock.calls[1]);
 expect(applicationPdf).toHaveBeenCalledWith(['page'], 'AFhomes-SILVER-RA-Preview.pdf');
});
