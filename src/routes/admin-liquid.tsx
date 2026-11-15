import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/admin-liquid')({
  component: Outlet,
});
