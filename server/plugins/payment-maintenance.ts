import { definePlugin } from 'nitro';
import { reconcilePendingPayments } from '../../src/lib/kani-payment-maintenance.server';

export default definePlugin(app => {
  app.hooks.hook('cloudflare:scheduled', async () => {
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
  });
});
