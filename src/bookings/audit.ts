import { Prisma } from '@prisma/client';

// Appends a row to the audit trail. Works with the normal client and inside transactions.
export function auditBooking(
  client: Prisma.TransactionClient,
  bookingId: string,
  action: string,
  actorId: string | null,
  meta?: Prisma.InputJsonObject,
) {
  return client.auditLog.create({
    data: { entity: 'Booking', entityId: bookingId, action, actorId, meta },
  });
}
