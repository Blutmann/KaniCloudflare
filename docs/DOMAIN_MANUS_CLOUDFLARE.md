# kanibarber.com con DNS administrado por Manus

## Estado comprobado el 1 de noviembre de 2026

- El registrador mantiene `ns1.globaldomaingroup.com` y `ns2.globaldomaingroup.com`.
- El dominio raíz y `www` publican `104.18.26.246`, pero HTTPS no funciona.
- El Worker `kanibarberstudio-cloudflare.kanibarber.workers.dev` responde con HTTP 200.
- El usuario indica que Manus permite editar registros DNS, pero no cambiar servidores DNS ni transferir hasta el 7 de diciembre de 2026.

Una transferencia y un cambio de servidores DNS son operaciones distintas. Si soporte de Manus habilita el segundo, se podrá conectar directamente el dominio al Worker sin transferirlo.

## Conexión de www sin transferir ni cambiar servidores DNS

Cloudflare Pages admite subdominios con DNS externo. El directorio `domain-gateway` contiene una entrada Pages que entrega todas las solicitudes al Worker existente mediante un Service binding. Conserva la URL pública, métodos, cuerpos, cookies, Origin y respuestas; los próximos despliegues del Worker quedan disponibles a través de la misma conexión.

1. Publicar la versión del Worker que permite configurar `KANI_CANONICAL_HOST`.
2. En ese Worker, configurar `KANI_CANONICAL_HOST=www.kanibarber.com`. El `wrangler.jsonc` raíz ya declara ese valor para conservarlo en cada despliegue. Sin esa variable se conserva la redirección anterior de www hacia el dominio raíz.
3. Crear un proyecto **Pages**, `kani-domain-gateway`, en la misma cuenta Cloudflare que el Worker. Elegir integración Git con este repositorio, directorio raíz `domain-gateway`, sin comando de compilación y salida `public`. El archivo `domain-gateway/wrangler.jsonc` declara el binding `KANI_APP` al servicio `kanibarberstudio-cloudflare`. Si se configura desde el panel, verificar ese binding y volver a desplegar.
4. Comprobar primero la URL `pages.dev` exacta asignada por Cloudflare. No asumir que el nombre solicitado está disponible.
5. En Pages → Custom domains, añadir `www.kanibarber.com` **antes** de cambiar DNS.
6. Manus debe publicar un único CNAME para `www`, dirigido a la URL base `pages.dev` real asignada al proyecto, sin `https://` ni ruta. TTL: 1 minuto o el mínimo permitido. Si existe un registro A/AAAA o CNAME para ese mismo nombre, habrá que editarlo o retirarlo; un CNAME no puede coexistir con esos registros.
7. Esperar que Pages indique dominio activo y certificado emitido. Verificar con HTTPS la página principal, reservas, recursos estáticos y acceso administrativo. No crear reservas ni ejecutar pagos como parte de una prueba DNS.

Registro guardado en Manus para el proyecto Pages publicado y comprobado:

| Tipo | Nombre | Valor |
|---|---|---|
| CNAME | www | kani-domain-gateway.pages.dev |

El proyecto Pages `kani-domain-gateway` está publicado, enlazado al Worker mediante `KANI_APP` y configurado para seguir `main`. La asociación `www.kanibarber.com` se trasladó del dominio personalizado del Worker a Pages. Manus confirmó el CNAME y conservó ambos TXT de Google. La resolución DNS pública y la emisión del certificado siguen pendientes de verificación; guardar un registro en el panel no demuestra que el servidor autoritativo ya lo publique.

Conectar este Worker mantiene su entorno y credenciales actuales, incluidos los ajustes de prueba de pagos. El dominio por sí solo no convierte la aplicación en un entorno de pagos reales.

## Dominio raíz sin www

Pages requiere servidores DNS Cloudflare para el dominio raíz. No se soluciona agregando un CNAME `@` a `workers.dev`, copiando IP de Cloudflare, ni añadiendo registros NS en el editor DNS común.

Opciones para `https://kanibarber.com`:

- Solicitar a Manus un cambio de servidores DNS, sin transferencia, para activar la zona y conectar directamente raíz y www al Worker.
- Mantener DNS externo y usar un servicio HTTPS de redirección del raíz a www, con sus registros A/AAAA o CNAME/ALIAS y validaciones propios. Requiere configurar el servicio y el certificado; DNS solo no produce una redirección HTTP.
- Cloudflare CNAME setup requiere Business o Enterprise. Cloudflare for SaaS es otra alternativa si ya existe otra zona activa en Cloudflare; el dominio raíz externo requiere que el DNS soporte aplanamiento CNAME/ALIAS o una opción de apex proxying apropiada.

Una opción concreta para redirigir el raíz es [redirect.pizza](https://redirect.pizza/support/redirecting-non-www-to-www), que documenta HTTPS automático y un plan gratuito. Configurar primero el origen `kanibarber.com`, destino `https://www.kanibarber.com` y conservación de rutas y parámetros. Después aplicar en Manus el registro A exacto que indique la cuenta del servicio. No apuntar al servicio antes de crear esa configuración. Esto requiere una cuenta adicional; la aplicación seguiría ejecutándose en Cloudflare. Los límites del plan deben comprobarse en el panel antes de activarlo.

## Verificación local

```text
node --test domain-gateway/gateway.test.mjs
pnpm exec vitest run src/test/kani-domain-canonical-routing.test.ts
pnpm run build
```

## Documentación oficial

- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/functions/bindings/#service-bindings
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/
- https://help.manus.im/en/articles/11711203-how-can-i-connect-manage-the-website-created-by-manus-to-my-custom-domain

## Reversión

Restaurar el registro DNS anterior de www y retirar `KANI_CANONICAL_HOST` del Worker devuelve el comportamiento anterior. El Worker y sus cron jobs no dependen del proyecto Pages; no se duplican ni migran al gateway.
