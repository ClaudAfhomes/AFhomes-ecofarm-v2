import { PortalSection, ui, type PortalSectionProps } from './portal-ui';
import money from './money.module.css';

/** Customer surface wrapping a titled section; shared by points, redemptions and payments. */
export function MoneyPanel(props: PortalSectionProps) {
  return (
    <div className={`${ui.surface} ${money.panel}`}>
      <PortalSection {...props} />
    </div>
  );
}
