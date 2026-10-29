# Phase 5 completion

Complete all remaining Phase 5 locally, preserving the already-bootstrapped admin.
Existing Atlas/Supabase data, remote writes, messages, commits and deployment
remain outside scope. Use the existing fresh replica fixture for all writes.

- [ ] Port complete customer write/read models and explicit integrity/index setup.
- [ ] Port exact multi-purchase/reservation directory totals, filters and masking.
- [ ] Implement points periods/position, ledger cursor paging and credential rotation.
- [ ] Repair native session/RBAC integration using actual provider APIs and UUIDs.
- [ ] Wire an explicit local Mongo runtime with converted-route-only dispatch.
- [ ] Connect existing customer/admin interfaces through cookie auth without redesign.
- [ ] Exercise real database, HTTP and browser flows including denial/reload cases.
- [ ] Run final regression/type/lint/build/env checks and replace stale phase status.

Source user behavior overrides experimental docs: staff uses temporary passwords;
VIP customers use activation codes/links. Catalog deactivates, never deletes.
