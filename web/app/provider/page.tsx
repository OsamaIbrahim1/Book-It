'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatWhen } from '@/lib/actions';
import { api, money } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Booking, Paginated, Service } from '@/lib/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Rule {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}
interface DayState {
  enabled: boolean;
  start: string;
  end: string;
}

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export default function ProviderPage() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user || user.role !== 'PROVIDER') {
    return (
      <p>
        This page is for provider accounts. <Link href="/login">Log in</Link> as <code>provider@bookit.dev</code> or sign
        up with &quot;I offer services&quot;.
      </p>
    );
  }
  return (
    <>
      <h1>My business</h1>
      <ServicesSection />
      <HoursSection />
      <BookingsSection />
    </>
  );
}

function ServicesSection() {
  const [providerId, setProviderId] = useState('');
  const [items, setItems] = useState<Service[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('25');
  const [duration, setDuration] = useState('60');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await api.get<{ id: string }>('/providers/me');
      setProviderId(me.id);
      const res = await api.get<Paginated<Service>>(`/services?providerId=${me.id}&limit=50&sort=newest`);
      setItems(res.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/services', {
        title,
        priceCents: Math.round(Number(price) * 100),
        durationMin: Number(duration),
      });
      setTitle('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.del(`/services/${id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Services</h2>
      {items.length === 0 && providerId && <p className="muted">No services yet. Add your first one below.</p>}
      {items.map((s) => (
        <div key={s.id} className="card row">
          <div>
            <strong>{s.title}</strong>
            <div className="muted">
              {money(s.priceCents, s.currency)} · {s.durationMin} min
            </div>
          </div>
          <button className="secondary" onClick={() => void remove(s.id)}>
            Remove
          </button>
        </div>
      ))}
      <form className="card stack" style={{ maxWidth: 'none' }} onSubmit={create}>
        <strong>Add a service</strong>
        <div className="filters">
          <input placeholder="Title (min 3 characters)" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
          <input type="number" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} title="Price in USD" />
          <input type="number" min={15} max={480} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: 100 }} title="Minutes" />
          <button>Add</button>
        </div>
        <span className="muted">Price in USD, duration in minutes (15 to 480).</span>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function HoursSection() {
  const [days, setDays] = useState<DayState[]>(
    DAYS.map((_, i) => ({ enabled: i <= 4, start: '09:00', end: '17:00' })),
  );
  const [multi, setMulti] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ rules: Rule[] }>('/providers/me/availability')
      .then(({ rules }) => {
        if (rules.length === 0) return;
        const next: DayState[] = DAYS.map(() => ({ enabled: false, start: '09:00', end: '17:00' }));
        for (const r of rules) {
          if (next[r.dayOfWeek].enabled) setMulti(true); // second window on one day: not editable here
          else next[r.dayOfWeek] = { enabled: true, start: toTime(r.startMinute), end: toTime(r.endMinute) };
        }
        setDays(next);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  function update(i: number, patch: Partial<DayState>) {
    setDays(days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function save() {
    setError('');
    setMessage('');
    const rules = days.flatMap((d, i) =>
      d.enabled ? [{ dayOfWeek: i, startMinute: toMinutes(d.start), endMinute: toMinutes(d.end) }] : [],
    );
    try {
      await api.put('/providers/me/availability', { rules });
      setMessage('Working hours saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section>
      <h2>Working hours</h2>
      <div className="card">
        {days.map((d, i) => (
          <div key={DAYS[i]} className="row" style={{ marginBottom: 6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', width: 140 }}>
              <input type="checkbox" checked={d.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
              {DAYS[i]}
            </label>
            <span>
              <input type="time" value={d.start} disabled={!d.enabled} onChange={(e) => update(i, { start: e.target.value })} /> to{' '}
              <input type="time" value={d.end} disabled={!d.enabled} onChange={(e) => update(i, { end: e.target.value })} />
            </span>
          </div>
        ))}
        {multi && (
          <p className="muted">
            Some days have more than one window. This form shows only the first, and saving replaces the rest.
          </p>
        )}
        <button onClick={() => void save()}>Save hours</button>
        {message && <p className="notice">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

function BookingsSection() {
  const [items, setItems] = useState<Booking[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<Paginated<Booking>>('/bookings?limit=50')
      .then((res) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: 'complete' | 'cancel') {
    setError('');
    try {
      await api.patch(`/bookings/${id}/${action}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section>
      <h2>Bookings</h2>
      {items.length === 0 && <p className="muted">No bookings yet.</p>}
      {items.map((b) => {
        const started = new Date(b.startsAt).getTime() <= Date.now();
        return (
          <div key={b.id} className="card">
            <div className="row">
              <div>
                <strong>{b.serviceTitle}</strong>
                <div className="muted">
                  {b.customerName} · {formatWhen(b.startsAt)} · {money(b.priceCents, b.currency)}
                </div>
              </div>
              <span className={`badge ${b.status}`}>{b.status}</span>
            </div>
            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              {b.status === 'CONFIRMED' && started && <button onClick={() => void act(b.id, 'complete')}>Mark completed</button>}
              {(b.status === 'PENDING' || b.status === 'CONFIRMED') && (
                <button className="secondary" onClick={() => void act(b.id, 'cancel')}>
                  Cancel (refunds the customer)
                </button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
