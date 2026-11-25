'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatWhen, startPayment } from '@/lib/actions';
import { api, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Booking, Paginated } from '@/lib/types';

export default function BookingsPage() {
  const { user, ready } = useAuth();
  const [data, setData] = useState<Paginated<Booking> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<Paginated<Booking>>('/bookings?limit=50')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!ready) return null;
  if (!user) {
    return (
      <p>
        Please <Link href="/login">log in</Link> to see your bookings.
      </p>
    );
  }

  return (
    <>
      <h1>My bookings</h1>
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">No bookings yet.</p>}
      {data?.items.map((b) => (
        <div key={b.id} className="card">
          <div className="row">
            <div>
              <Link href={`/bookings/${b.id}`}>
                <strong>{b.serviceTitle}</strong>
              </Link>
              <div className="muted">
                {b.providerName} · {formatWhen(b.startsAt)} · {money(b.priceCents, b.currency)}
              </div>
            </div>
            <span className={`badge ${b.status}`}>{b.status}</span>
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            {b.status === 'PENDING' && (
              <button onClick={() => void run(() => startPayment(b.id))}>Pay now</button>
            )}
            {(b.status === 'PENDING' || b.status === 'CONFIRMED') && (
              <button className="secondary" onClick={() => void run(() => api.patch(`/bookings/${b.id}/cancel`))}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
