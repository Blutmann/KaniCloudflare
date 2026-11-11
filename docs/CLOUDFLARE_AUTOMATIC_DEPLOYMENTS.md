# KANI BARBER STUDIO — Configuración de Despliegues Automáticos en Cloudflare

Este documento detalla la causa raíz de la etiqueta **"Manually deployed"** (Desplegado manualmente) en el panel de Cloudflare y la configuración definitiva para que cada cambio integrado a la rama `main` se publique automáticamente a producción.

---

## 1. Diagnóstico: ¿Por qué figuraba "Manually deployed"?

En Cloudflare Workers y Pages, una versión recibe la etiqueta **"Manually deployed"** en cualquiera de estos tres escenarios:

1. **Despliegues directos vía CLI/API (`npx wrangler deploy`):**
   - Cuando se ejecuta el comando de despliegue desde una máquina local o terminal externa, Cloudflare lo registra como una subida directa vía API.
   - Estos despliegues no quedan asociados al webhook de Git y Cloudflare les asigna automáticamente la etiqueta *"Manually deployed"*.
   - A principios de noviembre, debido a los bloqueos de scripts con `pnpm` (`ERR_PNPM_IGNORED_BUILDS`) y la validación de previews de Wrangler, se recurrió a despliegues directos por CLI para destrabar el entorno.

2. **Aprobación manual / Promoción de versiones (Gradual Deployments):**
   - Si en Cloudflare Workers Builds la compilación genera una nueva versión pero la opción **Automatic deployments** está desactivada o configurada para no promover automáticamente el 100% del tráfico, la versión queda en estado lista pero no asignada.
   - Cuando un operador ingresa a la pestaña *Deployments / Versions* del Worker y hace clic en **"Deploy"** o **"Promote"**, Cloudflare marca esa acción humana como *"Manually deployed"*.

3. **Ausencia de pipeline de despliegue en GitHub Actions:**
   - El workflow existente (`.github/workflows/staff-validation.yml`) está diseñado exclusivamente para ejecutar pruebas en Pull Requests y ramas de desarrollo (`without production deploy`), sin realizar publicaciones a Cloudflare.

---

## 2. Configuración para Despliegues 100% Automáticos

Con las correcciones de dependencias (`allowBuilds` en `pnpm-workspace.yaml`) y configuración de previews (`wrangler.jsonc`) ya aplicadas en el repositorio, la integración nativa de Cloudflare Workers Builds está lista para operar de forma desatendida.

### Pasos en el Dashboard de Cloudflare:

1. Ingresar a [Cloudflare Dashboard](https://dash.cloudflare.com/) y seleccionar la cuenta correspondiente.
2. Ir a **Workers & Pages** > seleccionar el Worker **`kanibarberstudio-cloudflare`**.
3. Ir a la pestaña **Settings** > sección **Builds** (o **Build & Deployments**).
4. Verificar y configurar los siguientes campos:
   - **Repository:** `Blutmann/KaniCloudflare`
   - **Production branch:** `main`
   - **Build command:** `pnpm run build`
   - **Deploy command:** `npx wrangler deploy` *(o `npx wrangler deploy --config .output/server/wrangler.json`)*
   - **Root directory:** `/` (raíz del repositorio)
5. En **Automatic deployments / Branch control**:
   - Asegurarse de que el interruptor **Automatic deployments** esté **Habilitado (Enabled / Active)** para la rama `main`.
   - Si estaba en estado *Paused* (Pausado), activarlo.

A partir de este ajuste, cada `git push` o merge a la rama `main` desencadenará automáticamente el build y el despliegue al 100% del tráfico, mostrando el commit hash y el autor de Git en lugar de "Manually deployed".
