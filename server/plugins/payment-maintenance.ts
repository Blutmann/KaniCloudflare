import { definePlugin } from 'nitro';
import { reconcilePendingPayments } from '../../src/lib/kani-payment-maintenance.server';

export default definePlugin(app => {
  app.hooks.hook('cloudflare:scheduled', async () => {
    try {
      const { dispatchStaffRecoveryEmails } = await import('../../src/lib/kani-staff-recovery.server');
      await dispatchStaffRecoveryEmails();
    } catch { console.warn('[Staff recovery] Deferred to next scheduled run'); }
    try {
      await reconcilePendingPayments();
    } catch (err) {
      console.error('[Scheduled Payment Maintenance Error]:', err);
    }

    try {
      const { processCalendarSyncQueue } = await import('../../src/lib/kani-google-calendar-sync');
      const syncResult = await processCalendarSyncQueue();
      if (syncResult && syncResult.processed > 0) {
        console.log('[Scheduled Calendar Sync]:', JSON.stringify(syncResult));
      }
    } catch (err) {
      console.error('[Scheduled Calendar Sync Error]:', err);
    }

    // Nitro owns the deployed scheduled entry (src/server.ts is the HTTP entry).
    try {
      const { dispatchBarberConfirmationEmails } = await import('../../src/lib/kani-barber-email.server');
      const result = await dispatchBarberConfirmationEmails({ limit:10 });
      if (result.processed || result.failed) console.log('[Scheduled Barber Email Recovery]', JSON.stringify(result));
    } catch {
      console.warn('[Scheduled Barber Email Recovery] Deferred to next scheduled run');
    }
  });
});
