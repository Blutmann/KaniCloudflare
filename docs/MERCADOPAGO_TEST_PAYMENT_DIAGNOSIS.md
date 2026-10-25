# Primer pago oficial TEST — diagnóstico del retorno

Caso autorizado: primer pago oficial TEST del 25/10/2026. Base: `3fb6d22`. Sólo DEV/Preview. Los identificadores siguientes son sustitutos sanitizados del fixture; los originales no se publican en Git.

## Evidencia real, de solo lectura

- Payment: approved/accredited, ARS 5000 y external_reference igual al appointment. Su `order.id` es el Merchant Order `9876543210`, type mercadopago.
- Order: online/manual, processed/accredited, currency ARS, total_amount y total_paid_amount "5000.00". Su transacción tiene id propio PAY…, reference_id "123456789012", status processed/accredited y amount/paid_amount "5000".
- Callback/retornos apuntan a Preview; auto_return all y expiration_time PT10M.
- La fila persistente contiene la Order canónica exacta y expected_amount_ars=5000, pero paid_amount_ars era null y reconciliation_status PENDING. El appointment estaba PENDING.
- No había reservas CONFIRMED/COMPLETED en colisión al inspeccionar el horario.
- La identidad autenticada del vendedor está marcada por Mercado Pago como test_user y coincide con el collector del Payment. No se utilizaron credenciales del comprador ni se crearon pagos/turnos.

## Dos fallos encadenados

1. **Navegador:** TanStack deserializa payment_id/collection_id numéricos como number. La página casteaba el objeto a strings y llamaba paymentId.trim(). Chromium sobre Preview reprodujo TypeError y cero llamadas al servidor. El texto de acreditación era el fallback de error, no el estado certificado de Mercado Pago.
2. **Servidor:** incluso normalizando el ID, la validación comparaba el Merchant Order del Payment legacy con el ID canónico de Orders API. La respuesta real muestra que son espacios de identificadores distintos. Esa comparación bloqueaba un Payment legítimo antes de confirmar.

## Corrección

- Helper cliente puro que normaliza IDs numéricos seguros/strings. No interpreta status=approved como prueba y no usa merchant_order_id como ID de Orders API.
- Asociación Payment↔Order mediante transactions.payments[].reference_id del recurso Orders autenticado, que debe coincidir con el Payment autenticado y estar acreditado.
- Se conservan ID canónico persistido, reference del turno, moneda, importe exacto, Order acreditada, RPC privada, protección de colisión e idempotencia.
- No se cambian calendario, creación de turnos, monto, esquema de Supabase, eventos externos ni arquitectura de pago.

## Regresión

Fixture JSON basado en la respuesta real, con identificadores sustituidos y sin payer/client_token/credenciales. Cubre la forma real de strings monetarios, reference_id y Merchant Order separado. Antes de corregir el backend fallaban tres regresiones; después pasan.

Pruebas adicionales: IDs numéricos deserializados, aliases, rechazo de tipos malformados, IDs cruzados/reference ausente, moneda/importe incorrectos, pending/rejected y reprocesamiento sin nuevos cobros ni notificaciones duplicadas. Chromium local confirma que el retorno numérico llega al backend sin TypeError.

Validación: 81 pruebas focalizadas aprobadas, build aprobado. Suite completa: 402 aprobadas y dos fallos preexistentes ajenos al cambio (rangos de estadísticas y distribución de columnas de turnos manuales).

## Webhook histórico: límite de evidencia

La consulta oficial de Cloudflare Workers Observability devolvió HTTP 200 y cero eventos para este Worker entre 16:28 y 16:38 UTC del 25/10/2026, tanto buscando la Order como el endpoint y todos los eventos del Worker. Esto NO demuestra que Mercado Pago no lo haya enviado. No se puede reconstruir su HTTP, HMAC ni event/topic original sin registros o historial de entregas del proveedor.

No se cambiaron arbitrariamente los eventos configurados. No hay una función processMercadoPagoOrder en esta versión: el flujo se llama verifyAndConfirmAppointmentPayment. El formato de la Order se comprobó con la API oficial real; no se sustituyó por supuestos de mocks.

## Reprocesamiento seguro autorizado

Después del despliegue Preview, abrir el retorno existente con los IDs del mismo caso permite al backend consultar de nuevo Payment y Order, comprobar todas las invariantes y ejecutar la RPC atómica. No se fuerza estado con SQL ni se fabrica un pago. Si la RPC detecta cancelación, pago tardío o colisión, debe rechazar y preservar la reserva ajena. El resultado remoto final se informa después del despliegue y se verifica mediante lecturas independientes.
