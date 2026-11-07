# Imported sales visibility and commission cutover

Authorized scope: local implementation on claud/clean-develop; no shared migrations or release actions.

- Show imported applications, reservations and sales to the recorded referrer/recommender and recorded IST leaders, using verified import links rather than reconstructing old genealogy.
- Keep imported records in a separate, paginated section so incomplete applications and already settled history do not inflate normal sales/commission KPIs.
- Preserve customer-name permissions and current team authorization. No unrelated account visibility.
- Freeze commission policy from the original imported state: Active VIP, Fully Paid and fully settled inactive history are settled before the system; pending/unpaid history continues through existing commission rules and manual qualification.
- Do not fabricate paid commission transactions, historical rates, receipts or qualification. No rewriting frozen existing purchase terms.
- Verify the ten-customer workbook, settled suppression, unpaid finalization, self/team visibility, authorization, pagination, API contracts and UI states locally.
