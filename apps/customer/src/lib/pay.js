// Paying online (D-84): the app opens the server's payment page in the in-app browser, then asks the server
// to check with the gateway. The app never decides that something is paid.
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

/**
 * @param {{ api: any, apiUrl: string, orderId: string, payment?: any }} i
 * @returns {Promise<{ outcome: string, orderStatus: string, payment: any }>} the server's verdict
 */
export async function payOnline({ api, apiUrl, orderId, payment }) {
  // A missing or expired link is refreshed by the server (it also creates the gateway order if needed).
  const p = payment?.canPay ? payment : await api.post(`/v1/customer/orders/${orderId}/payment`);
  const returnTo = Linking.createURL('payment');
  const url = `${apiUrl}${p.pay.path}?t=${encodeURIComponent(p.pay.token)}&returnTo=${encodeURIComponent(returnTo)}`;
  await WebBrowser.openAuthSessionAsync(url, returnTo);
  return api.post(`/v1/customer/orders/${orderId}/payment/verify`);
}
