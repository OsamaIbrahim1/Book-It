'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatWhen, startPayment } from '@/lib/actions';
import { api, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Booking } from '@/lib/types';

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { user, ready } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const polls = useRef(0);

  const load = useCallback(
    () =>
      api
        .get<Booking>(`/bookings/${id}`)
        .then((b) => {
          setBooking(b);
          return b;
        })
        .catch((e: Error) => {
          setError(e.message);
          return null;
        }),
    [id],
  );

  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  // After paying, Stripe redirects here with ?paid=1. The webhook confirms the booking a moment later,
  // so the page checks every 2 seconds (up to 30 seconds) instead of trusting the redirect.
  useEffect(() => {
    if (!ready || !user) return;
    if (new URLSearchParams(window.location.search).get('paid') !== '1') return;
    setWaiting(true);
    const timer = setInterval(async () => {
      polls.current += 1;
      const b = await load();
      if ((b && b.status !== 'PENDING') || polls.current >= 15) {
        clearInterval(timer);
        setWaiting(false);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [ready, user, load]);

  if (!ready) return null;
  if (!user) {
    return (
      <p>
        Please <Link href="/login">log in</Link>.
      </p>
    );
  }
  if (!booking) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>;

  return (
    <>
      <p>
        <Link href="/bookings">&larr; My bookings</Link>
      </p>
      <h1>{booking.serviceTitle}</h1>
      <div className="card">
        <div className="row">
          <span className={`badge ${booking.status}`}>{booking.status}</span>
          <strong>{money(booking.priceCents, booking.currency)}</strong>
        </div>
        <p>
          {booking.providerName}
          <br />
          {formatWhen(booking.startsAt)} to {formatWhen(booking.endsAt)}
        </p>
        {booking.status === 'PENDING' && booking.expiresAt && (
          <p className="muted">The slot is held until {formatWhen(booking.expiresAt)}. Pay before then.</p>
        )}
        {waiting && <p className="notice">Payment received, waiting for confirmation...</p>}
        {booking.status === 'CONFIRMED' && <p className="notice">Your booking is confirmed.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          {booking.status === 'PENDING' && (
            <button onClick={() => void startPayment(booking.id).catch((e: Error) => setError(e.message))}>
              Pay now
            </button>
          )}
          {(booking.status === 'PENDING' || booking.status === 'CONFIRMED') && (
            <button
              className="secondary"
              onClick={() =>
                void api
                  .patch(`/bookings/${booking.id}/cancel`)
                  .then(load)
                  .catch((e: Error) => setError(e.message))
              }
            >
              Cancel booking
            </button>
          )}
        </div>
      </div>
    </>
  );
}
