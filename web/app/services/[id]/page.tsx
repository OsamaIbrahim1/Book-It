'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { startPayment, formatWhen } from '@/lib/actions';
import { ApiError, api, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Booking, Service, SlotsResponse } from '@/lib/types';

function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ServicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [service, setService] = useState<Service | null>(null);
  const [date, setDate] = useState(tomorrow());
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Service>(`/services/${id}`).then(setService).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!service || !date) return;
    setSelected(null);
    setSlots(null);
    api
      .get<SlotsResponse>(`/providers/${service.provider.id}/slots?date=${date}&serviceId=${service.id}`)
      .then((res) => {
        setSlots(res);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [service, date]);

  async function book() {
    if (!user) return router.push('/login');
    if (!service || !selected) return;
    setBusy(true);
    setError('');
    let booking: Booking | null = null;
    try {
      booking = await api.post<Booking>('/bookings', { serviceId: service.id, startsAt: selected });
      await startPayment(booking.id);
    } catch (err) {
      if (booking) {
        // The slot is held for 30 minutes even if payment could not start (for example Stripe is not configured).
        router.push(`/bookings/${booking.id}`);
        return;
      }
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Someone just took this slot. Pick another one.'
          : (err as Error).message,
      );
      setSelected(null);
      // Refresh the list so the taken slot disappears.
      if (service) {
        api
          .get<SlotsResponse>(`/providers/${service.provider.id}/slots?date=${date}&serviceId=${service.id}`)
          .then(setSlots)
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!service) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>;

  const tz = slots?.timezone ?? service.provider.timezone;
  return (
    <>
      <p>
        <Link href="/">&larr; All services</Link>
      </p>
      <h1>{service.title}</h1>
      <div className="card">
        <div className="muted">
          {service.provider.name}
          {service.provider.city ? `, ${service.provider.city}` : ''}
        </div>
        {service.description && <p>{service.description}</p>}
        <strong>{money(service.priceCents, service.currency)}</strong>{' '}
        <span className="muted">· {service.durationMin} min</span>
      </div>

      <h2>Pick a time</h2>
      <label style={{ maxWidth: 220 }}>
        Date
        <input type="date" value={date} min={tomorrow()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p className="muted">Times are shown in the provider&apos;s time zone ({tz}).</p>

      {!slots && !error && <p className="muted">Loading times...</p>}
      {slots && slots.slots.length === 0 && <p className="muted">No free times on this day.</p>}
      <div className="slots">
        {slots?.slots.map((s) => (
          <button
            key={s.startsAt}
            className={`slot ${selected === s.startsAt ? 'selected' : ''}`}
            onClick={() => setSelected(s.startsAt)}
          >
            {new Date(s.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      <div style={{ marginTop: 16 }}>
        <button disabled={!selected || busy} onClick={() => void book()}>
          {busy ? 'Booking...' : selected ? `Book and pay · ${formatWhen(selected, tz)}` : 'Select a time'}
        </button>
        {!user && <p className="muted">You will be asked to log in first.</p>}
      </div>
    </>
  );
}
