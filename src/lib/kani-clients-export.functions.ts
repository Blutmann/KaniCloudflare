import { createServerFn } from '@tanstack/react-start';
import type { ClientExportRow } from './kani-clients-export.server';

export const staffExportClientsFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { token?: string } | undefined) => data ?? {})
  .handler(async ({ data }): Promise<ClientExportRow[]> => {
    const { staffExportClients } = await import('./kani-clients-export.server');
    return staffExportClients(data?.token);
  });
