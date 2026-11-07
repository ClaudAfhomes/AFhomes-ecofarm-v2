# Public IST/OST verification privacy notice — draft for owner review

Prepared 2026-10-21. Historical review draft; the owner subsequently approved the
operational notice in `ist-ost-search-privacy-notice.txt`, configurable retention
starting at 30 days, and `claudmarsjimenez.afhomes@gmail.com` as the privacy contact.
The questions below are retained as review history, not runtime configuration.

Before publication, the owner must supply the registered operator's name and business
address, the responsible privacy contact and a working email/phone, confirm the lawful
basis for this processing, and approve the retention/deletion schedule. Thirty days
below is a proposed operational setting, not a statutory retention period.

## Proposed notice text

AFHomes provides this service so you can check an IST or OST representative's current
identity/accreditation using their AA number. The service is operated by
**[registered operator and address — owner to confirm]**.

Before showing a result, we ask for your name, email address and mobile number. We
validate their format, but do not verify that you own the email address or phone number.
We store a contact record privately and reuse an existing record when the complete
normalized name, email and mobile combination matches. Searching for a different
representative does not by itself create another contact record.

We use these details to operate the verification service, identify repeat submissions
and support safeguards against misuse. They are not collected as permission to send
marketing or shared with the representative you search for. The operator must confirm
and document the applicable lawful basis before enabling collection.

The browser keeps a random session identifier and a signed contact receipt so that you
do not need to re-enter your details for every search. These are not a copy of your
contact details. The receipt lasts up to 24 hours. A fresh acknowledgment and anti-bot
check are still required for each verification.

We also use a keyed representation of your IP address, request identifiers, timestamps
and the notice version for rate limits, retry handling and successful-search allowance
checks. The current implementation permits three successful disclosures per IP address
in a rolling 24 hours. A requested seven-day allowance has not yet been implemented.

The result shows the representative's masked name, AA number, profile photo when
available, and applicable validity information. It does not give you access to their
private account, identity documents, contact details or transaction records.

Cloudflare Turnstile processes browser/network information to check for automated
requests. Vercel hosts the website/API and Supabase stores service data. Access to
stored contact data is restricted to authorized server processes; browser users cannot
read the contact/security tables directly. Provider processing, hosting locations and
applicable contractual safeguards must be confirmed by the operator before publication.

**Proposed retention:** contact records become eligible for deletion 30 days after
creation, not 30 days after their latest reuse. Search disclosure records become
eligible after 30 days; inactive attempt records become eligible after 30 days without
an update. A verified, monitored cleanup schedule must process the bounded deletion
batches. The final notice must state that schedule and any resulting deletion delay,
as well as applicable backup and legally required retention arrangements.

You may request information about this processing, access or correction of your
personal data, or erasure/blocking where applicable. You may raise privacy concerns
with **[privacy contact name, email and phone — owner to confirm]** or the National
Privacy Commission. Requests will be evaluated against applicable rights, obligations
and identity-verification requirements.

If you do not provide the requested details and acknowledge this notice, this online
verification workflow will not disclose a result. You can contact AFHomes through its
official company verification number, +63 960-431-6867, for assistance.

Proposed acknowledgment: “I have read the AFHomes IST/OST Verification Privacy Notice
and understand how my information is used for this verification service.”

## References checked

- [NPC: the right to be informed](https://privacy.gov.ph/the-right-to-be-informed/).
- [Data Privacy Act: processing principles, criteria and data-subject rights](https://privacy.gov.ph/data-privacy-act/).
- [Cloudflare: Turnstile setup and server-side verification](https://developers.cloudflare.com/turnstile/get-started/).

This draft describes the current implementation and proposed operations. It does not
certify legal compliance, completed provider review, active cleanup, or owner approval.
