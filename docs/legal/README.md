# Jamzo legal pages — drafts for review

Status: **DRAFTS written by the developer (2026-10-16), not legal advice.** They describe how Jamzo actually works
(sources: DECISIONS.md D-70, D-82 … D-87, D-110, D-111, D-112; SECURITY.md; PAYMENTS.md). They must be read by the
owner and checked by a lawyer or CA before they are published in the apps (Q-12).

| File | Shown where | Publish in Admin as slug |
|---|---|---|
| [terms.md](terms.md) | Customer app → Account → Terms of use; checkout | `terms` |
| [privacy.md](privacy.md) | All apps → Privacy policy; store listings (required by Apple, Google, Razorpay) | `privacy` |
| [refunds.md](refunds.md) | Customer app → Cancellation and refund policy; Razorpay requires it | `refunds` |
| [contact.md](contact.md) | Website / Razorpay "Contact us"; grievance officer (E-Commerce Rules 2020) | `contact` |
| [restaurant-partner-agreement.md](restaurant-partner-agreement.md) | Signed by each restaurant at onboarding | — |
| [delivery-partner-agreement.md](delivery-partner-agreement.md) | Accepted by each delivery partner when applying | — |

## Fill in before publishing (search for `[[`)
- `[[LEGAL NAME]]` — the business's legal name (proprietor's name, or firm/company name) and trade name "Jamzo".
- `[[OWNER NAME]]`, `[[ADDRESS]]` (registered address), `[[GSTIN]]` (when registered), `[[UDYAM]]`.
- `[[GRIEVANCE OFFICER]]` — a named person in India, with email and phone (E-Commerce Rules 2020, DPDP Act).
- `[[SUPPORT PHONE]]`, `[[EFFECTIVE DATE]]`.
- Commission and payout values in the partner agreements come from the rules set in Jamzo Admin.

## Points the lawyer/CA must decide (marked `[[REVIEW: …]]` in the text)
1. **Markup (Q-4):** Jamzo's customer prices can be higher than the restaurant's own menu prices. Is this
   allowed for Jamzo's model, must it be disclosed, and does it make Jamzo the seller?
2. **GST (Q-3):** under Section 9(5) the platform usually pays GST on restaurant food; the owner may switch tax off
   on bills (D-111). The terms must match what is actually charged.
3. **Cancellation after acceptance:** no refund (D-70). Confirm this is fair under consumer protection rules.
4. **Delivery partners are independent contractors**, not employees (check the Social Security Code 2020 rules
   for gig workers that apply in Gujarat).
5. **Data stored outside India:** photos and documents in Singapore (D-112) — allowed under the DPDP Act unless
   restricted; confirm.

## Must be built before store submission
- **In-app account deletion** (Apple 5.1.1(v), Google Play account deletion policy). Designed in SECURITY.md §5,
  not yet built; until then privacy.md says deletion is done on request.
