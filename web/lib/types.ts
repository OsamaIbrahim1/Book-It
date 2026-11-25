export type Role = 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Service {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  durationMin: number;
  provider: { id: string; name: string; city: string | null; timezone: string };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

export interface SlotsResponse {
  date: string;
  timezone: string;
  slots: Slot[];
}

export interface Booking {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  expiresAt: string | null;
  serviceId: string;
  serviceTitle: string;
  priceCents: number;
  currency: string;
  providerName: string;
  customerName: string;
}
