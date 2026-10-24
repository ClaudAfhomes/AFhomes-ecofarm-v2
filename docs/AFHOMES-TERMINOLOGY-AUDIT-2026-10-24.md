# AFhomes terminology audit

Branch: `claud/clean-develop`. Scope: literal display text and matching text expectations only. Audit prepared before edits. No commit, push, migration or deployment authorized for this pass.

Approved copy reference: `AFhomes_Terminology_Text_Only_Correction_Guide.md`, supplied from Downloads. Current explicit terminology decisions in that guide supersede older UI labels only within the allowed text-only scope.

## Original sources read individually

- `AFhomes_Bronze_VIP_Grant_Contract_Standard_Pricing_Updated.pdf` — 9 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AFhomes_Silver_VIP_Grant_Contract_Standard_Pricing_Updated.pdf` — 9 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AFhomes_Gold_VIP_Grant_Contract_Standard_Pricing_Updated.pdf` — 9 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Supplementary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AFhomes_Bronze_VIP_Grant_Contract_Section_by_Section_Training.docx` — 212 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AFhomes_Silver_VIP_Grant_Contract_Section_by_Section_Training.docx` — 197 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AFhomes_Gold_VIP_Grant_Contract_Section_by_Section_Training.docx` — 214 pages/paragraphs read. Terms checked: AFhomes, Grant of VIP Privileges, VIP Privilege Card, Primary Cardholder, Supplementary Cardholder, Annual Welcome Gift, Loyalty Stay Points, Card Claim Date, Points Activation Date.
- `AF-Homes-reservation (1).pdf` — 1 pages/paragraphs read. Terms checked: AFhomes.
- `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx` — 117 pages/paragraphs read. Terms checked: AFhomes, Qualifying Period, Closed Deal TCP, Qualified TCP, Performance Bonus, Override Commission, SVD.
- `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx` — 148 pages/paragraphs read. Terms checked: AFhomes, Qualifying Period, Closed Deal TCP, Performance Bonus, SVD.
- `A6-AFhomes_Operations_Manual-2026-09-10a.docx` — 178 pages/paragraphs read. Terms checked: AFhomes, Qualifying Period, Closed Deal TCP, SVD.

Brand capitalization follows the supplied current guide; original contracts intentionally retain uppercase legal headings. These originals are not edited.

## Literal inventory and decisions

| File:line | Current text | Corrected text / retained | Source | Confidence | Class |
| --- | --- | --- | --- | --- | --- |
| `packages/ui/src/tier-artwork.ts:17` | Gold VIP membership card | Gold VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `packages/ui/src/tier-artwork.ts:18` | Silver VIP membership card | Silver VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `packages/ui/src/tier-artwork.ts:19` | Bronze VIP membership card | Bronze VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `packages/ui/src/tier-artwork.ts:37` | AFHomes VIP | AFhomes VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `packages/ui/src/components/ErrorState.tsx:25` | Please try again. If this continues, contact AFHomes support. | Please try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `packages/ui/src/components/AuthLayout.tsx:68` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/app/OstLayout.tsx:78` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/app/OstLayout.tsx:112` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/app/CustomerLayout.tsx:72` | Your customer access could not be verified. Please sign out and contact AFHomes if this continues. | Your customer access could not be verified. Please sign out and contact AFhomes if this continues. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/app/CustomerLayout.tsx:99` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/app/CustomerLayout.tsx:110` | Your card and points are not available while this is in effect. Contact AFHomes Ecofarm to restore access. | Your card and points are not available while this is in effect. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminForbiddenPage.tsx:25` | AFHomes logo | AFhomes logo | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminForbiddenPage.tsx:66` | Sign out of AFHomes administration? | Sign out of AFhomes administration? | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminLayout.tsx:58` | AFHomes logo | AFhomes logo | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminLayout.tsx:60` | AFHomes | AFhomes | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminLayout.tsx:78` | AFHomes administration | AFhomes administration | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/app/AdminLayout.tsx:144` | Sign out of AFHomes administration? | Sign out of AFhomes administration? | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/staff/StaffEntryPage.tsx:144` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/genealogy/GenealogyDetailsPage.tsx:325` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MembershipsPage.tsx:280` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MembershipDetailPage.tsx:397` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MembershipCardPrintPage.tsx:132` | AFHomes membership card for | AFhomes VIP Privilege Card for | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/admin/src/features/memberships/MembershipCardPrintPage.tsx:136` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MembershipCardPrintPage.tsx:161` | Present this card with a valid ID at any AFHomes Ecofarm desk. | Present this card with a valid ID at any AFhomes Ecofarm desk. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MembershipCardPrintPage.tsx:184` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/MemberLookupPage.tsx:202` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/memberships/CustomerLookupPage.tsx:444` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/ost/OstResetPasswordPage.tsx:124` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/ost/OstRegisterPage.tsx:110` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/ost/OstRegisterPage.tsx:136` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/ost/OstLoginPage.tsx:93` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/ost/OstForgotPasswordPage.tsx:74` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/afhomes/AfHomesDashboardPage.tsx:349` | AFHomes · Staff console | AFhomes · Staff console | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/PortalLoginPage.tsx:144` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/AdminResetPasswordPage.tsx:126` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/AdminMfaPage.tsx:28` | AFHomes administrator | AFHomes administrator | C — Auth MFA enrollment metadata, not ordinary display copy | High | C |
| `apps/admin/src/features/auth/AdminMfaPage.tsx:48` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/AdminMfaPage.tsx:50` | Secure access to AFHomes. | Secure access to AFhomes. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/AdminForgotPasswordPage.tsx:95` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/auth/AdminActivateAccountPage.tsx:194` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/afhomes/PublicVerificationSettingsPage.tsx:398` | Save settings | Save Changes | Guide §6 (approved display labels) | High | A |
| `apps/admin/src/features/network-members/OstTeamTransferDialog.tsx:117` | The OST joins the selected SM’s existing SSM and VD team. No IST conversion or renewal is performed. | The OST joins the selected SM’s existing SSM and SVD team. No IST conversion or renewal is performed. | Guide §5; original A4 ¶48 and A6 ¶33 | High | A |
| `apps/admin/src/features/network-members/MemberWorkbookDialog.tsx:200` | IST — VD / SSM / SM | IST — SVD / SSM / SM | Guide §5; original A4 ¶48 and A6 ¶33 | High | A |
| `apps/admin/src/features/network-members/MemberWorkbookDialog.tsx:236` | Read the README. Keep matching rows across Identity, Team and Details; OST also uses Accreditation. IST can include VD → SSM → SM in one workbook. OST requires an existing active SM team. | Read the README. Keep matching rows across Identity, Team and Details; OST also uses Accreditation. IST can include SVD → SSM → SM in one workbook. OST requires an existing active SM team. | Guide §5; original A4 ¶48 and A6 ¶33 | High | A |
| `apps/admin/src/features/network-members/MemberFormDialog.tsx:775` | Vice Directors have no head. | SVDs have no head. | Guide §5; existing no-head rule preserved | High | A |
| `apps/web/src/features/customer/PointRedemptionApprovals.tsx:57` | Missing dates ? ask staff to prepare a dated request | Missing dates — ask staff to prepare a dated request | Guide §8 (unambiguous punctuation only) | High | A |
| `apps/web/src/features/customer/CustomerResetPasswordPage.tsx:114` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerRedemptionsPage.tsx:31` | Your account is not active, so redemptions are not available. Contact AFHomes Ecofarm to restore access. | Your account is not active, so redemptions are not available. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerRedemptionsPage.tsx:44` | No redemptions yet. Points are spent with AFHomes Ecofarm staff. | No redemptions yet. Points are spent with AFhomes Ecofarm staff. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerProfilePage.tsx:106` | To correct any of these, contact AFHomes Ecofarm. Your account details are maintained by the branch that registered you. | To correct any of these, contact AFhomes Ecofarm. Your account details are maintained by the branch that registered you. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerPointsPage.tsx:132` | Your account is not active, so points are not available. Contact AFHomes Ecofarm to restore access. | Your account is not active, so points are not available. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerPointsPage.tsx:146` | Weekday points (Monday?Friday) | Weekday points (Monday–Friday) | Guide §8 (range punctuation; actual weekday/weekend rule unchanged) | High | A |
| `apps/web/src/features/customer/CustomerPointsPage.tsx:147` | Weekend points (Saturday?Sunday) | Weekend points (Saturday–Sunday) | Guide §8 (range punctuation; actual weekday/weekend rule unchanged) | High | A |
| `apps/web/src/features/customer/CustomerPointsPage.tsx:183` | When AFHomes Ecofarm records a purchase for you, you get a claim code. Enter it here or scan its QR, review the purchase, then confirm to add the points to your card. | When AFhomes Ecofarm records a purchase for you, you get a claim code. Enter it here or scan its QR, review the purchase, then confirm to add the points to your card. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerPointsPage.tsx:230` | Camera ready. Point it at the claim QR shown by AFHomes. | Camera ready. Point it at the claim QR shown by AFhomes. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerPaymentsPage.tsx:24` | Your account is not active, so payments are not available. Contact AFHomes Ecofarm to restore access. | Your account is not active, so payments are not available. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:57` | Your account is not active, so your card is not available. Contact AFHomes Ecofarm to restore access. | Your account is not active, so your card is not available. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:122` | Your AFHomes Ecofarm member QR code | Your AFhomes Ecofarm member QR code | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:135` | Show this QR or code at any AFHomes Ecofarm desk. It never changes, and viewing it never invalidates anything. | Show this QR or code at any AFhomes Ecofarm desk. It never changes, and viewing it never invalidates anything. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:152` | AFHomes card | AFhomes VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:206` | Your AFHomes Ecofarm member QR code | Your AFhomes Ecofarm member QR code | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerMembershipPage.tsx:215` | Show this at any AFHomes Ecofarm desk, in case the QR code cannot be scanned. Staff enter it by hand. | Show this at any AFhomes Ecofarm desk, in case the QR code cannot be scanned. Staff enter it by hand. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerLoginForm.tsx:171` | No customer access is assigned to this account. Contact AFHomes for assistance. | No customer access is assigned to this account. Contact AFhomes for assistance. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerForgotPasswordPage.tsx:82` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerDashboardPage.tsx:130` | Your account is not active, so your card is not available. Contact AFHomes Ecofarm to restore access. | Your account is not active, so your card is not available. Contact AFhomes Ecofarm to restore access. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerDashboardPage.tsx:140` | AFHomes card | AFhomes VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/web/src/features/customer/CustomerActivatePage.tsx:95` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/features/customer/CustomerActivatePage.tsx:122` | AFHomes Ecofarm | AFhomes Ecofarm | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/marketing/data/mock/site.ts:15` | https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort | https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort | C — Existing URL | High | C |
| `apps/web/src/marketing/data/mock/site.ts:21` | https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort | https://www.facebook.com/AFHomes.Hotspring.and.Ecofarm.Resort | C — Existing URL | High | C |
| `apps/web/src/marketing/data/mock/site.ts:41` | AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. Payments must be made directly to the AFhomes Finance Department through official and verified channels. | AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. Payments must be made directly to the AFhomes Finance Department through official and verified channels. | B — Legal/compliance notice | High | B |
| `apps/web/src/marketing/data/mock/pageContent.ts:142` | AFHOMES operates with openness. Official corporate, licensing, and regulatory documentation is published here as it becomes available. | AFHOMES operates with openness. Official corporate, licensing, and regulatory documentation is published here as it becomes available. | B — Compliance publication wording | High | B |
| `apps/web/src/marketing/data/mock/pageContent.ts:144` | AFHOMES is a hospitality and resort developer and operator. Our work is guided by responsible, phase-by-phase development with environmental and governmental compliance at every step. | AFHOMES is a hospitality and resort developer and operator. Our work is guided by responsible, phase-by-phase development with environmental and governmental compliance at every step. | B — Compliance/legal statement | High | B |
| `apps/web/src/marketing/data/mock/pageContent.ts:145` | AFHOMES does not offer real estate investments, timeshares, club shares, or securities. | AFHOMES does not offer real estate investments, timeshares, club shares, or securities. | B — Legal disclaimer | High | B |
| `apps/web/src/marketing/data/mock/pageContent.ts:204` | AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. The VIP Privilege Program grants loyalty privileges and discounts only. | AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. The VIP Privilege Program grants loyalty privileges and discounts only. | B — Legal disclaimer | High | B |
| `apps/web/src/marketing/data/mock/faq.ts:94` | No. AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. | No. AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities. | B — Legal disclaimer | High | B |
| `apps/web/src/marketing/data/mock/faq.ts:104` | No. The VIP Privilege Program is a loyalty privileges program, not an investment. AFHOMES does not offer real estate investments, timeshares, club shares, or securities. | No. The VIP Privilege Program is a loyalty privileges program, not an investment. AFHOMES does not offer real estate investments, timeshares, club shares, or securities. | B — Legal disclaimer | High | B |
| `apps/admin/src/features/business/CustomerDetailPage.tsx:52` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/business/CustomerDetailPage.tsx:66` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/marketing/pages/SaleTeamSearch.tsx:327` | I acknowledge that I have read the AFHomes IST/OST Accreditation Verification Privacy Notice and understand how my personal information may be processed for the purposes described in the notice. I understand that the verification service is intended to help confirm an individual's current accreditation status and that AFHomes may apply security measures to prevent misuse of the service. | I acknowledge that I have read the AFHomes IST/OST Accreditation Verification Privacy Notice and understand how my personal information may be processed for the purposes described in the notice. I understand that the verification service is intended to help confirm an individual's current accreditation status and that AFHomes may apply security measures to prevent misuse of the service. | B — Existing privacy acknowledgment text | High | B |
| `apps/web/src/marketing/pages/Compliance.tsx:17` | AFHOMES is a hospitality and resort developer and operator. Compliance, licensing, and corporate transparency information — published as official documentation becomes available. | AFHOMES is a hospitality and resort developer and operator. Compliance, licensing, and corporate transparency information — published as official documentation becomes available. | B — Legal/compliance SEO statement | High | B |
| `apps/web/src/marketing/pages/CmsPage.tsx:66` | AFHomes | AFhomes | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/business/official-forms-applications.tsx:415` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/admin/src/features/business/CustomerImportExportPage.tsx:203` | Check your connection and try again. If this continues, contact AFHomes support. | Check your connection and try again. If this continues, contact AFhomes support. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/marketing/lib/services.ts:24` | Contact AFHomes for service details. | Contact AFhomes for service details. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/marketing/lib/services.ts:25` | Contact AFHomes for service details. | Contact AFhomes for service details. | Terminology guide §2 (ordinary branding) | High | A |
| `apps/web/src/marketing/lib/images.ts:128` | Gold VIP membership card | Gold VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/web/src/marketing/lib/images.ts:129` | Silver VIP membership card | Silver VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/web/src/marketing/lib/images.ts:130` | Bronze VIP membership card | Bronze VIP Privilege Card | Guide §3; Bronze/Silver/Gold original contracts p.1 | High | A |
| `apps/admin/src/features/business/UseVipPointsPage.tsx:378` | Monday?Friday uses weekday points; Saturday?Sunday uses weekend points. Overnight points are divided across each night's date. Check-out is excluded. | Monday–Friday uses weekday points; Saturday–Sunday uses weekend points. Overnight points are divided across each night's date. Check-out is excluded. | Guide §8 (range punctuation; actual weekday/weekend rule unchanged) | High | A |
| `apps/web/src/marketing/components/VerificationResultCard.tsx:43` | Account No.: | Account Number: | Guide §6 (approved display labels) | High | A |
| `apps/web/src/marketing/components/VerificationResultCard.tsx:88` | Registration Status | Verification Status | Guide §§5–6 (current public-result decision) | High | A |

No visible `Qualified TCP` or `Override Commission` misuse was found in the scanned UI literals. Existing public IST/OST results continue to omit `Valid Until`; backend accreditation validity is unchanged.

## Deferred and protected terms

- `packages/contracts/src/schemas/member.ts:65` and server-provided `account.role` / role names: current shared role labels include Sales Vice Director or Vice Director. Schema/backend changes are forbidden in this pass. Static frontend references can say SVD; dynamic labels remain unchanged. No role identifier or permission changes.
- `CustomerMembershipPage.tsx` renders `Activated` from `activatedAt`. A backend activation timestamp does not prove a contractual Card Claim Date. Label retained.
- Weekday/non-holiday and weekend/holiday wording: current approved application behavior classifies actual Monday–Friday vs Saturday–Sunday service dates. Adding holiday wording would imply a holiday policy the implementation does not establish. Allocation labels and calculations retained; malformed date-range punctuation only corrected.
- Import UI VIP card ID/purchase-reference wording, workbook column names and generated identifiers retained. Earlier explicit decisions require purchase reference to equal the VIP card ID; no format/identifier changes are authorized.
- Dynamic CMS, product, Admin support/bank, contact and reminder values remain untouched. No saved records are normalized.
- Legal/privacy/compliance notices and acknowledgment text are flagged B, even where their capitalization differs. No historic agreements, PDFs, source DOCX files or legal templates changed.
- `api/_lib/customer-onboarding-email.ts:86-109` still contains legacy branding in server-rendered email copy. Backend edits are explicitly forbidden in this pass; report for separate approval rather than altering it.
- Existing uppercase text-transform CSS may render corrected source branding in all capitals. CSS is protected; no styling override was added.
- URLs, QR payloads (`AFHOMES:`), API/schema/JSON keys, module names, comments, paths and authentication metadata are C and remain untouched.

## Original-source discrepancies

- Silver training paragraph 41 describes an eligible Bronze cardholder. Not corrected in the original.
- Bronze training paragraph 54 says ten annual cycles; operative Bronze wording establishes five conditional annual gifts. No entitlement/points logic changed.
- A7 glossary paragraph 11 describes Override Commission, while A4 guide paragraph 24 says it is not used at AFhomes and identifies Performance Bonus. Do not infer commission behavior from that mixed glossary. No corresponding unsafe UI replacement was found.
- Gold/Silver pricing inconsistencies identified by the supplied guide remain for management/legal review. Prices and placeholders are not changed.

## Additional reviewed literal corrections

All additional rows have high confidence; test rows change only matching display copy and preserve every assertion.

| File:line | Current | Corrected | Source | Class |
| --- | --- | --- | --- | --- |
| `packages/ui/src/tier-artwork.ts:35` | } VIP`; | } VIP Privilege Card`; | Original VIP contracts p.1; display suffix only, interpolation unchanged | A |
| `apps/web/src/features/customer/PointRedemptionApprovals.tsx:59` | ? Weekday: | · Weekday: | Guide §8, broken display punctuation only | A |
| `apps/web/src/features/customer/PointRedemptionApprovals.tsx:59` | ? Weekend: | · Weekend: | Guide §8, broken display punctuation only | A |
| `apps/admin/src/app/AdminLayout.spec.tsx:42` | AFHomes administration | AFhomes administration | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/ist/IstPortalPage.spec.tsx:328` | AFHomes administration | AFhomes administration | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/afhomes/analytics-dashboard.spec.tsx:244` | AFHomes · Staff console | AFhomes · Staff console | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/memberships/Memberships.spec.tsx:246` | AFHomes membership card for Pedro Reyes | AFhomes VIP Privilege Card for Pedro Reyes | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/memberships/Memberships.spec.tsx:248` | AFHomes Ecofarm | AFhomes Ecofarm | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/memberships/CustomerLookupPage.spec.tsx:214` | Gold VIP membership card | Gold VIP Privilege Card | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/memberships/CustomerLookupPage.spec.tsx:215` | Silver VIP membership card | Silver VIP Privilege Card | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/memberships/CustomerLookupPage.spec.tsx:216` | Bronze VIP membership card | Bronze VIP Privilege Card | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/business/CardPlans.spec.tsx:323` | Gold VIP membership card | Gold VIP Privilege Card | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/afhomes/PublicVerificationSettingsPage.spec.tsx:63` | Save settings | Save Changes | Matching display-string test expectation/fixture only | A |
| `apps/admin/src/features/network-members/MembersPage.spec.tsx:330` | Vice Directors have no head. | SVDs have no head. | Matching display-string test expectation/fixture only | A |
| `apps/web/src/marketing/pages/SaleTeamSearch.spec.tsx:222` | Registration Status | Verification Status | Matching display-string test expectation/fixture only | A |
| `packages/ui/src/components/parity.spec.tsx:24` | AFHomes Ecofarm | AFhomes Ecofarm | Matching display-string test expectation/fixture only | A |
| `apps/admin/index.html:6` | AFHomes Ecofarm operations console | AFhomes Ecofarm operations console | Guide §2, ordinary page metadata | A |
| `apps/admin/index.html:8` | AFHomes Ecofarm - Administration | AFhomes Ecofarm - Administration | Guide §2, browser title | A |

Total: 85 production display-text corrections in 48 files, plus corresponding text-only expectations/fixtures in 10 test files. The source audit inventories 9 flagged legal/privacy literals and 3 protected technical literals; additional dynamic/schema/identifier cases are listed above.

AST verification passed for all 57 changed TypeScript/TSX files: tree structure and every non-string leaf match their pre-edit versions. The HTML diff is exactly two brand-spelling changes. No API, schema, database, CSS, assets or numeric changes.

## Verification

- Affected Admin tests: 127 passed across 8 files (`corepack pnpm --filter @afhomes/admin exec vitest run --maxWorkers=2` with the eight changed Admin specs).
- Complete Web suite: 262 passed across 21 files (`corepack pnpm --filter @afhomes/web exec vitest run --maxWorkers=2`).
- Complete shared UI suite: 230 passed across 32 files (`corepack pnpm --filter @afhomes/ui exec vitest run --maxWorkers=2`).
- `corepack pnpm typecheck`: all 7 workspaces passed.
- `corepack pnpm lint`: passed; existing warnings only.
- `corepack pnpm build`: both apps passed; existing chunk-size warnings only.
- Literal-only AST comparison: passed for all 57 TypeScript/TSX files; HTML comparison permits exactly two capitalization corrections. No changed branches, operators, numeric literals, JSX nodes, imports, keys, URLs, styles or routes.
- `git diff --check`: passed.
- Read-only authenticated localhost browser: AFhomes sidebar/accessibility branding, browser title `AFhomes Ecofarm - Administration`, and `Save Changes` button verified. No save action, record update, database write or new account operation performed.
- API and database suites not rerun: no API/backend/schema/migration changes in this text-only pass. No new full E2E claim.
- Existing dirty generated import results, Supabase CLI marker, earlier draft reports and screenshots were preserved.
- No commit, push, merge, deployment or live SQL performed. The originals in Downloads are unchanged.

Ignored local evidence: `.tmp-bin/terminology-*`. Screenshot: `outputs/browser-import-2026-10-24/terminology-settings-copy.png`.
