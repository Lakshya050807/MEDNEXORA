# MEDNEXORA Public Launch Readiness

This is an owner-input and approval checklist, not legal advice. The existing `OWNER_LAUNCH_INPUTS.md` contains prompts and examples, not completed owner answers. No answers, policies, approvals, or business details have been inferred here.

The public footer also contains two owner-confirmation notices for business/service information and examination information sources/limitations. These are covered by the About Us and exam-information inputs below and must be updated only after the corresponding owner wording is confirmed.

## Current state

All six public information pages below are unfinished. Each page is visibly marked **DRAFT — NOT APPROVED FOR PUBLIC USE** and remains excluded from search indexing. Public registration and new paid checkouts are disabled by default in production. Existing student login, free-resource claims, free-course enrollment, and verification of existing payment orders remain separate from this gate.

## Pages and owner inputs still required

### About Us — `/about`

- [ ] Full legal name of the person or entity operating MEDNEXORA, applicable entity type/registration details if any, and the relationship between that operator and the MEDNEXORA brand.
- [ ] Accurate description of services actually available, intended learners, and geographic availability.
- [ ] Exact wording and evidence for any qualifications, affiliations, content-review process, outcomes, or other claims; otherwise confirm those claims should be omitted.
- [ ] How examination information is sourced and maintained, how corrections are handled, and what limitations or non-affiliation statement is accurate.

### Contact Us — `/contact`

- [ ] A working, monitored customer-support email and/or other contact method; who monitors it and which kinds of enquiries it accepts.
- [ ] Support hours or response expectations only if the owner can confirm and will publish them.
- [ ] Public business/correspondence address and address type, if applicable and approved for display; otherwise confirm that no address will be published.
- [ ] Approved contact route for privacy, account deletion, order, download, and refund requests.

### FAQ — `/faq`

- [ ] Actual registration requirements and the student information collected.
- [ ] Accurate availability, preview, purchase, access duration, download, course, mock-test, and supported-device/browser answers.
- [ ] Correct meanings of pending, failed, paid, refunded, and other order statuses used by the live service.
- [ ] Approved refund/cancellation answers and support contact; these must match the finalized policy pages.
- [ ] Accurate explanation of exam information sources, updates, corrections, and any affiliation or limitations.
- [ ] Common troubleshooting answers that are supported by current product behavior.

### Privacy Policy — `/privacy-policy`

- [ ] Every student/account, learning, practice, progress, order/payment, support, device, cookie, analytics, log, and other data category actually collected; identify required and optional data.
- [ ] The actual purposes for collecting and using each category.
- [ ] Hosting, database, storage, payment, support, analytics, error-monitoring, and other service providers; what each receives and why, plus confirmed hosting region or cross-border handling if stated.
- [ ] Retention rule/period for each relevant category, including backups and transaction records.
- [ ] Accurate process for access, correction, and account/data deletion requests, including identity checks and records retained after a request.
- [ ] Privacy contact, named approver/role, effective date, version/update method, and appropriate review of the final text.

### Terms and Conditions — `/terms-and-conditions`

- [ ] Legal operator identity and accurate account requirements/responsibilities.
- [ ] Products and services sold, when access starts, duration/limits, previews, download/streaming restrictions, technical requirements, and treatment of unavailable content.
- [ ] Approved acceptable-use and service-change rules.
- [ ] Confirmation of ownership or licenses for each offered material; student permissions for personal use, printing, copying, sharing, and redistribution; infringement-reporting contact/process.
- [ ] Correct purchase, payment, failed/pending-order, refund, and access-revocation terms matching the implemented system and approved refund policy.
- [ ] Contact, policy approver, effective date/version, and appropriate review of the final text.

### Refund and Cancellation Policy — `/refund-cancellation-policy`

- [ ] Owner-approved refund eligibility and exclusions, including free resources, digital access/download, partially used resources, bundles, duplicate charges, technical failures, partial refunds, and any other applicable cases.
- [ ] How to request a refund, required order details, submission channel, review/decision process, and notification method.
- [ ] Confirmed review and payment-provider/bank timelines stated separately; do not promise a time that cannot be supported.
- [ ] Cancellation treatment for unpaid, pending, failed, abandoned, and successfully paid orders; any recurring arrangement must be described accurately.
- [ ] Access behavior after full/partial refund or cancellation, consistent with the implemented access rules.
- [ ] Support contact, approving owner/role, effective date/version, and appropriate review of the final text.

## Activation procedure

The server fails closed in a production runtime. Production defaults registration and new paid checkouts to disabled. Enabling either feature requires all six explicit page-approval settings below to be `true`; otherwise startup is rejected. This is an operator declaration, not an automatic policy approval. The website pages themselves must first be replaced with final owner-approved text and their draft notices removed in a reviewed code change.

After every page is complete and approved:

1. Set all six `PUBLIC_*_APPROVED=true` approval variables in the backend deployment environment.
2. Explicitly set `PUBLIC_BETA_REGISTRATION_ENABLED=true` to open public account creation.
3. To accept paid purchases, additionally set `PUBLIC_BETA_PAID_PURCHASES_ENABLED=true`. Paid purchases are rejected unless `APP_ENV=production`; the existing production configuration also requires `RAZORPAY_MODE=live` and the required live credentials. This gate does not configure payment credentials or change payment verification.
4. Keep either feature variable `false` or unset to leave that feature closed. Do not change Railway or Vercel configuration as part of this checklist without a separate deployment approval.
5. Check `GET /api/launch/status` after a reviewed deployment. It returns only whether registration and paid purchases are enabled; it does not expose the approval settings.

Approval variables:

- `PUBLIC_ABOUT_PAGE_APPROVED`
- `PUBLIC_CONTACT_PAGE_APPROVED`
- `PUBLIC_FAQ_PAGE_APPROVED`
- `PUBLIC_PRIVACY_POLICY_APPROVED`
- `PUBLIC_TERMS_PAGE_APPROVED`
- `PUBLIC_REFUND_POLICY_APPROVED`
- `PUBLIC_BETA_REGISTRATION_ENABLED`
- `PUBLIC_BETA_PAID_PURCHASES_ENABLED`

No production environment variables were changed for this checklist.
