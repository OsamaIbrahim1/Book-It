import { api } from './api';

// Creates a Stripe Checkout session and sends the browser to Stripe's payment page.
export async function startPayment(bookingId: string) {
  const { url } = await api.post<{ url: string }>('/payments/checkout', { bookingId });
  window.location.href = url;
}

export function formatWhen(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  });
}
