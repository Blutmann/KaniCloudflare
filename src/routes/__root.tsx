import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import "@fontsource-variable/inter";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { KaniProvider } from '@/components/kani/store';
import { SiteHeader, SiteFooter } from '@/components/kani/site-header';
import {
  isLiquidGlassAdminPath,
  isLiquidGlassPath,
} from '@/components/kani/experimental/liquid-glass-shell';

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página no encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          La página que buscás no existe o fue movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          No pudimos cargar esta página
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo salió mal de nuestro lado. Podés reintentar o volver al inicio.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
            Reintentar
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Kani Barber Studio" },
      { name: "description", content: "Tu estilo. Tu momento. Kani Barber Studio, Zona Norte de Buenos Aires." },
      { property: "og:title", content: "Kani Barber Studio" },
      { property: "og:description", content: "Tu estilo. Tu momento. Reservas en Kani Barber Studio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Zen+Antique&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const ROOT_PREPAINT_SCRIPT = [
  "try{",
  "var d=document.documentElement;",
  "var t=window.localStorage.getItem('kani-theme');",
  "if(t==='dark'||t==='light'){d.dataset.theme=t;}",
  "else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){d.dataset.theme='dark';}",
  "else{d.dataset.theme='light';}",
  "var p=(window.location.pathname||'').replace(/\\/+$/,'')||'/';",
  "var c=p.slice(-4)==='-old'||p.indexOf('-old/')!==-1||p==='/reservar-turno-mercadopago'||p==='/reservar-mercadopago'||p==='/panel-v2'||p.indexOf('/panel-v2/')===0||p==='/reserva-v2'||p==='/reserva-v3'||p==='/reserva-v5'||p==='/admin'||p.indexOf('/admin/')===0||p==='/admin-v2'||p.indexOf('/admin-v2/')===0;",
  "var lgP=['/','/reservar','/contacto','/cancelar-turno','/panel-administracion','/panel-membresias','/panel-descuentos','/panel-turnos','/panel-horarios','/pago','/politica-de-privacidad','/terminos-y-condiciones','/admin-v2-liquid','/reservar-turno','/reservar-turno-liquid','/contacto-liquid','/admin-liquid','/politica-de-privacidad-liquid','/terminos-y-condiciones-liquid'];",
  "var lgA=['/panel-administracion','/panel-membresias','/panel-descuentos','/panel-turnos','/panel-horarios','/admin-v2-liquid','/admin-liquid'];",
  "var m=function(list){for(var i=0;i<list.length;i++){var x=list[i];if(x==='/'?p==='/':p===x||p.indexOf(x+'/')===0)return true;}return false;};",
  "var isLg=!c&&m(lgP);",
  "var isAdmin=!c&&m(lgA);",
  "if(isLg){d.dataset.liquidGlass='true';}else{delete d.dataset.liquidGlass;}",
  "if(isAdmin){d.dataset.lgAdmin='true';}else{delete d.dataset.lgAdmin;}",
  "}catch(e){}",
].join("");

function RootShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname || "/" });
  const isLiquidGlass = isLiquidGlassPath(pathname);
  const isLiquidGlassAdmin = isLiquidGlassAdminPath(pathname);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isLiquidGlass) {
      document.documentElement.dataset.liquidGlass = "true";
    } else {
      delete document.documentElement.dataset.liquidGlass;
    }
    if (isLiquidGlassAdmin) {
      document.documentElement.dataset.lgAdmin = "true";
    } else {
      delete document.documentElement.dataset.lgAdmin;
    }
  }, [isLiquidGlass, isLiquidGlassAdmin]);

  return (
    <html
      lang="es"
      data-liquid-glass={isLiquidGlass ? "true" : undefined}
      data-lg-admin={isLiquidGlassAdmin ? "true" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: ROOT_PREPAINT_SCRIPT,
          }}
        />
        <HeadContent />
      </head>
      <body
        className={isLiquidGlass ? "liquid-glass-active" : undefined}
        data-lg-admin={isLiquidGlassAdmin ? "true" : undefined}
        suppressHydrationWarning
      >
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <KaniProvider>
        <div className="site-shell">
          <SiteHeader />
          <Outlet />
          <SiteFooter />
        </div>
      </KaniProvider>
    </QueryClientProvider>
  );
}
