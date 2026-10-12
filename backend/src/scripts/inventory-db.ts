import 'dotenv/config';
import { closePrisma, getPrisma } from '../database/prisma.js';

const db = getPrisma();
try {
  const [users, sessions, refreshTokens, packagers, bookings, customerEntries,
    wallets, walletEntries, operations, auditEvents] = await Promise.all([
    db.appUser.count(),
    db.authSession.count(),
    db.refreshToken.count(),
    db.packager.count(),
    db.booking.count(),
    db.customerFundEntry.count(),
    db.wallet.count(),
    db.walletEntry.count(),
    db.operationRequest.count(),
    db.auditEvent.count(),
  ]);
  process.stdout.write(`${JSON.stringify({
    app_users: users,
    auth_sessions: sessions,
    refresh_tokens: refreshTokens,
    packagers,
    bookings,
    customer_fund_entries: customerEntries,
    wallets,
    wallet_entries: walletEntries,
    operation_requests: operations,
    audit_events: auditEvents,
  })}\n`);
} finally {
  await closePrisma();
}
