'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export function Header() {
  const { user, ready, logout } = useAuth();
  return (
    <header className="header">
      <Link href="/" className="brand">
        BookIt
      </Link>
      <nav>
        {ready && user ? (
          <>
            {user.role === 'PROVIDER' && <Link href="/provider">My business</Link>}
            <Link href="/bookings">My bookings</Link>
            <span className="muted">{user.name}</span>
            <button className="link" onClick={() => void logout()}>
              Log out
            </button>
          </>
        ) : (
          ready && (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/register">Sign up</Link>
            </>
          )
        )}
      </nav>
    </header>
  );
}
