/**
 * Official-form pages entry point.
 *
 * Re-exports the application and reservation pages, so existing routes and specs keep importing from './OfficialFormsPages'.
 */
export {
  CustomerApplicationsPage,
  CustomerApplicationEditorPage,
  humanizeApplicationIssues,
} from './official-forms-applications';
export { ReservationAgreementsPage, ReservationAgreementEditorPage } from './official-forms-reservations';
