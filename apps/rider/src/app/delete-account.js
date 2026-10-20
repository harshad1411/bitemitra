// Delete my account (D-120; required by the app stores): what it means for a delivery partner. The server says
// first if it has to wait (a delivery in progress, cash to deposit, earnings not yet paid).
import { AccountDeletion } from '@jamzo/mobile-foundation';

export default function DeleteAccount() {
  return (
    <AccountDeletion
      points={[
        'You go offline at once and get no more delivery requests or notifications.',
        'You need no cash in hand and no unpaid earnings first; Jamzo pays you everything owed.',
        'After 30 days we erase your name, number, address, photo, bank and UPI details and your documents.',
        'Your past trips, earnings and payouts are kept for accounts and tax records.',
        'Until then you can sign in again and keep your account. You cannot go online while it is waiting.',
      ]}
    />
  );
}
