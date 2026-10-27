import { definePlugin } from 'nitro';
import { reconcilePendingPayments } from '../../src/lib/kani-payment-maintenance.server';

export default definePlugin(app => {
  app.hooks.hook('cloudflare:scheduled', async () => {
    await reconcilePendingPayments();
  });
});
