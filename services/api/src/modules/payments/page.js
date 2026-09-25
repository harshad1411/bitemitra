// The payment page the customer app opens in the in-app browser (D-84). It runs the gateway's checkout and
// returns to the app; it never decides anything itself — the app then asks the server to verify.
import { randomBytes } from 'node:crypto';

/** Only the Jamzo customer app's own schemes may be returned to (no open redirect). */
const RETURN_TO = /^jamzo(-dev|-preview)?:\/\/payment$/;
export const safeReturnTo = (v) => (typeof v === 'string' && RETURN_TO.test(v) ? v : null);

const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * @param {{ provider: { name: string, publicKey: string | null }, payment: any, orderNumber: string,
 *   token: string, returnTo: string | null, message?: string | null }} i
 * @returns {{ html: string, csp: string }}
 */
export function renderPayPage({ provider, payment, orderNumber, token, returnTo, message = null }) {
  const nonce = randomBytes(16).toString('base64');
  const rupees = `₹${(payment.amountPaise / 100).toFixed(2)}`;
  const data = {
    paymentId: payment.id,
    token,
    returnTo,
    key: provider.publicKey,
    providerOrderId: payment.providerOrderId,
    amountPaise: payment.amountPaise,
    orderNumber,
  };
  const waiting = ['INITIATED', 'PENDING'].includes(payment.status) && payment.providerOrderId;
  const fake = provider.name === 'fake';
  const body = !waiting
    ? `<p>${esc(message ?? (payment.status === 'SUCCEEDED' ? 'This order is already paid.' : 'This payment can no longer be completed.'))}</p>`
    : fake
      ? `<p class="note">Test payment — development only. No money moves.</p>
         <button id="ok">Pay ${esc(rupees)} (test)</button>
         <button id="fail" class="secondary">Fail (test)</button>`
      : `<button id="pay">Pay ${esc(rupees)}</button>`;
  const script = !waiting
    ? ''
    : `const d = ${JSON.stringify(data).replace(/</g, '\\u003c')};
       const back = (result) => {
         if (d.returnTo) location.href = d.returnTo + '?paymentId=' + d.paymentId + '&result=' + result;
         else document.getElementById('msg').textContent = result === 'done' ? 'Done. You can close this page.' : 'Payment not completed.';
       };
       ${
         fake
           ? `const test = async (outcome) => {
                const r = await fetch('/v1/pay/' + d.paymentId + '/fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: d.token, outcome }) });
                back(r.ok && outcome === 'success' ? 'done' : 'failed');
              };
              document.getElementById('ok').onclick = () => test('success');
              document.getElementById('fail').onclick = () => test('fail');`
           : `const open = () => new Razorpay({
                key: d.key, amount: d.amountPaise, currency: 'INR', order_id: d.providerOrderId,
                name: 'Jamzo', description: 'Order ' + d.orderNumber,
                handler: () => back('done'),
                modal: { ondismiss: () => back('dismissed') },
              }).open();
              document.getElementById('pay').onclick = open;
              open();`
       }`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pay for your Jamzo order</title>
<style nonce="${nonce}">
body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px 16px;color:#1c1917;background:#fafaf9;text-align:center}
h1{font-size:20px;margin:0 0 4px}.amount{font-size:32px;font-weight:700;margin:16px 0}
button{display:block;width:100%;max-width:360px;margin:12px auto;padding:14px;border:0;border-radius:10px;background:#6d28d9;color:#fff;font-size:16px;font-weight:600}
button.secondary{background:#e7e5e4;color:#1c1917}.note{color:#b45309;font-size:14px}#msg{margin-top:16px;color:#57534e}
</style>
${!fake && waiting ? `<script nonce="${nonce}" src="https://checkout.razorpay.com/v1/checkout.js"></script>` : ''}
</head><body>
<h1>Jamzo</h1><div>Order ${esc(orderNumber)}</div><div class="amount">${esc(rupees)}</div>
${body}
<p id="msg"></p>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body></html>`;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://checkout.razorpay.com`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self' https://*.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    'img-src https: data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return { html, csp };
}
