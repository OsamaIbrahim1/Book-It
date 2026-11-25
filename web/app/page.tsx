'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import type { Paginated, Service } from '@/lib/types';

export default function HomePage() {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Service> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Small delay so typing does not fire a request on every keystroke.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: '12' });
      if (q.trim()) params.set('q', q.trim());
      if (city.trim()) params.set('city', city.trim());
      api
        .get<Paginated<Service>>(`/services?${params}`)
        .then((res) => {
          setData(res);
          setError('');
        })
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, city, page]);

  return (
    <>
      <h1>Find a service</h1>
      <div className="filters">
        <input
          placeholder="Search (e.g. haircut)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <input
          placeholder="City"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading...</p>}
      {data && data.items.length === 0 && <p className="muted">No services found.</p>}

      <div className="grid">
        {data?.items.map((s) => (
          <Link key={s.id} href={`/services/${s.id}`} className="card">
            <strong>{s.title}</strong>
            <div className="muted">
              {s.provider.name}
              {s.provider.city ? `, ${s.provider.city}` : ''}
            </div>
            <div>
              {money(s.priceCents, s.currency)} <span className="muted">· {s.durationMin} min</span>
            </div>
          </Link>
        ))}
      </div>

      {data && data.total > data.limit && (
        <div className="row" style={{ marginTop: 16 }}>
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {data.page} of {Math.ceil(data.total / data.limit)}
          </span>
          <button
            className="secondary"
            disabled={page >= Math.ceil(data.total / data.limit)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
