# Customer import and stay-date allowances

Local implementation only. No shared SQL, import, commit, push or deployment.

Approved: purchase reference is the official VIP card ID; Customer ID stays separate. Import confirmed remaining points, without repeat credit. Allocate 70 percent weekdays and 30 percent weekends. Redemption uses actual service date or each overnight date in Asia/Manila, never processing time. Buckets cannot exchange; missing legacy dates require a fresh dated request.

Scope: existing workbook parser/exporter and import SQL, canonical ID generators, customer read models; existing operational purchase quote, customer approval, settlement, refunds, ledger and portal forms. Old catalog redemption stays disabled. Preserve permissions, frozen prices, original history and verified-money checks.

Proof: versioned XLSX compatibility and real filled template, API/UI contracts, disposable PostgreSQL routing/reimport/date/bucket/approval/settlement/refund cases, RLS invariants and applicable existing checks. Browser cannot substitute shared-data mutations for local proof.
