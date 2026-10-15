<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Keep prototype appointments and barber availability in a shared React context, in memory only, so client and administrative flows reflect each other's mock changes without persistence or backend services.
- Render the shared sequential booking flow at both / and /reservar; administrative sections use distinct nested routes under an Outlet layout so existing URLs remain valid.
- Use pure shared model functions for service durations and interval-overlap availability so pending and confirmed appointments block the full service interval consistently.
- Use a fixed simulated date for mock agenda and calendar consistency; present it explicitly in the administrative agenda until the prototype is replaced by real scheduling.
- Prebundle all UI dependencies in Vite's initial optimization pass so discovering a dialog or icon dependency during navigation does not invalidate React module URLs in an open preview.
- Verify the shared administrative password only in server functions using server-only secrets and an encrypted HttpOnly session; the admin layout checks that session before rendering its Outlet, while appointment data remains explicitly fictional in memory.
