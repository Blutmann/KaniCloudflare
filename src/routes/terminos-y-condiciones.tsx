import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Building2, Calendar, Mail, MapPin, Scale, ShieldAlert } from 'lucide-react';
import { pageHead } from '@/lib/kani-head';
import '@/legal-pages.css';

export const Route = createFileRoute('/terminos-y-condiciones')({
  head: () =>
    pageHead(
      'Términos y Condiciones',
      'Términos y Condiciones generales de contratación de servicios y reservas en Kani Barber Studio.',
      'Términos y Condiciones · Kani Barber Studio',
    ),
  component: TerminosYCondicionesPage,
});

export function TerminosYCondicionesPage() {
  return (
    <main className="legal-page" id="contenido-principal">
      <div className="site-container legal-container">
        {/* Navegación superior */}
        <nav className="legal-back-nav" aria-label="Navegación de retorno">
          <Link to="/reservar-turno" className="legal-back-link">
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Volver a reservar</span>
          </Link>
        </nav>

        {/* Encabezado */}
        <header className="legal-header">
          <span className="legal-kicker">Kani Barber Studio · Documento Legal</span>
          <h1 className="legal-title">Términos y Condiciones</h1>
          <div className="legal-meta-row">
            <span className="legal-badge">
              <span className="legal-badge-dot" aria-hidden="true" />
              <span>Vigente</span>
            </span>
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <Calendar size={13} aria-hidden="true" className="shrink-0" />
              <span>Última actualización: 1 de noviembre de 2026</span>
            </span>
          </div>
          <p className="legal-lead">
            Los presentes Términos y Condiciones regulan la contratación de servicios de barbería y el uso del sistema de reservas online ofrecido por Kani Barber Studio a través de su sitio web oficial. Al utilizar nuestra plataforma para agendar una cita o abonar una seña, aceptás estas condiciones en su totalidad.
          </p>
        </header>

        {/* Índice de navegación rápida */}
        <nav className="legal-toc" aria-label="Índice de Términos y Condiciones">
          <h2 className="legal-toc-title">Índice de secciones</h2>
          <ol className="legal-toc-list">
            <li className="legal-toc-item">
              <a href="#servicios">
                <span className="legal-toc-number">01.</span> Servicios ofrecidos
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#reservas">
                <span className="legal-toc-number">02.</span> Proceso de reservas
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#senas">
                <span className="legal-toc-number">03.</span> Señas y abono de saldo
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#cancelaciones">
                <span className="legal-toc-number">04.</span> Política de cancelaciones
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#devoluciones">
                <span className="legal-toc-number">05.</span> Gestión de devoluciones
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#reprogramaciones">
                <span className="legal-toc-number">06.</span> Reprogramaciones
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#inasistencias">
                <span className="legal-toc-number">07.</span> Inasistencias
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#puntualidad">
                <span className="legal-toc-number">08.</span> Puntualidad y tolerancia
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#derecho-de-arrepentimiento">
                <span className="legal-toc-number">09.</span> Derecho de arrepentimiento
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#responsabilidad-y-disponibilidad">
                <span className="legal-toc-number">10.</span> Responsabilidad y disponibilidad
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#informacion-del-cliente">
                <span className="legal-toc-number">11.</span> Información del cliente
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#proteccion-de-datos">
                <span className="legal-toc-number">12.</span> Protección de datos
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#modificaciones-precios">
                <span className="legal-toc-number">13.</span> Precios y modificaciones
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#legislacion-aplicable">
                <span className="legal-toc-number">14.</span> Legislación y jurisdicción
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#contacto">
                <span className="legal-toc-number">15.</span> Contacto
              </a>
            </li>
          </ol>
        </nav>

        {/* Contenido de las 15 secciones */}
        <div className="legal-content">
          {/* 1. Servicios */}
          <section id="servicios" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">01.</span>
              <h2 className="legal-section-title">Servicios</h2>
            </div>
            <p>
              Kani Barber Studio brinda servicios profesionales de estética masculina, barbería y cuidado capilar en su establecimiento de Martínez. Entre los servicios principales se incluyen:
            </p>
            <ul>
              <li><strong>Corte de cabello:</strong> lavado, asesoramiento de estilo, corte técnico y peinado final.</li>
              <li><strong>Barba:</strong> arreglo, perfilado a navaja, toallas calientes e hidratación con aceites esenciales.</li>
              <li><strong>Corte con barba:</strong> servicio integral que combina corte de cabello y atención completa de barba.</li>
            </ul>
            <p>
              Los precios finales y las duraciones estimadas de cada servicio vigentes al momento de la contratación son los que se informan de manera clara y transparente durante el proceso de reserva en el sitio web antes de confirmar el turno.
            </p>
          </section>

          {/* 2. Reservas */}
          <section id="reservas" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">02.</span>
              <h2 className="legal-section-title">Reservas</h2>
            </div>
            <p>
              Las reservas se gestionan exclusivamente a través de la plataforma web oficial de Kani Barber Studio. El usuario selecciona el servicio deseado, el profesional de su preferencia (o la opción de primer barbero disponible), la fecha y el horario de su conveniencia.
            </p>
            <p>
              <strong>La confirmación definitiva del turno queda expresamente sujeta a la verificación de disponibilidad efectiva y a la acreditación del pago de la seña correspondiente.</strong> Hasta tanto la pasarela de pagos no confirme la acreditación del importe de la seña, el horario reservado permanecerá en estado pendiente con un tiempo de gracia limitado (habitualmente 10 minutos), liberándose automáticamente si el pago no se completa.
            </p>
          </section>

          {/* 3. Señas */}
          <section id="senas" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">03.</span>
              <h2 className="legal-section-title">Señas</h2>
            </div>
            <div className="legal-callout">
              <p>
                <strong>Importe vigente de la seña:</strong> Para todos los servicios del catálogo, el monto requerido de seña es de <strong>$5.000 ARS</strong>.
              </p>
            </div>
            <p>
              El importe abonado en concepto de seña se descuenta de forma íntegra del precio total del servicio contratado.
            </p>
            <p>
              El saldo restante del servicio se abonará presencialmente en el estudio al finalizar la atención, pudiendo utilizarse los medios de cobro habilitados en el local (efectivo, transferencia bancaria inmediata o medios electrónicos habilitados).
            </p>
          </section>

          {/* 4. Cancelaciones */}
          <section id="cancelaciones" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">04.</span>
              <h2 className="legal-section-title">Cancelaciones</h2>
            </div>
            <p>
              Entendemos que pueden surgir imprevistos. Para cancelar una reserva confirmada, se establecen las siguientes condiciones operativas:
            </p>
            <ul>
              <li>
                <strong>Cancelación con 24 horas o más de anticipación:</strong> Cuando el cliente comunique la cancelación con al menos 24 horas de antelación respecto del horario pactado, podrá solicitar el reintegro de la seña abonada o la reprogramación de su cita.
              </li>
              <li>
                <strong>Cancelación con menos de 24 horas de anticipación:</strong> Si la cancelación se produce con un plazo menor a 24 horas, Kani Barber Studio podrá retener el importe abonado en concepto de seña para cubrir los costos operativos y el tiempo de agenda reservado por el profesional, siempre que ello resulte legalmente procedente.
              </li>
            </ul>
            <p>
              Esta política comercial no limita ni sustituye en ningún caso los derechos irrenunciables que asisten al consumidor conforme a la legislación aplicable.
            </p>
          </section>

          {/* 5. Devoluciones */}
          <section id="devoluciones" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">05.</span>
              <h2 className="legal-section-title">Devoluciones</h2>
            </div>
            <p>
              En todos aquellos casos en que resulte procedente realizar una devolución conforme a las presentes condiciones o por imperio de la ley:
            </p>
            <ul>
              <li>Se gestionará el reintegro del importe correspondiente abonado por el usuario.</li>
              <li>El trámite administrativo de gestión de reintegro podrá demorar hasta <strong>10 días hábiles</strong> a partir de la aceptación y validación formal de la solicitud.</li>
              <li>La acreditación efectiva en la cuenta o tarjeta del titular podrá depender de los tiempos de procesamiento de la entidad bancaria emisora y del proveedor de cobros utilizado (Payway).</li>
              <li>Siempre que resulte técnicamente posible, la devolución se efectuará mediante el mismo medio de pago utilizado originalmente.</li>
              <li>Si Kani Barber Studio debiera cancelar un turno por causas atribuibles al estudio (fallas de infraestructura, fuerza mayor o indisponibilidad del profesional) y no pudiera acordarse una alternativa satisfactoria con el cliente, se reintegrará de inmediato el importe total abonado por el servicio no prestado, sin perjuicio de otros derechos que pudieran corresponderle.</li>
            </ul>
            <p>
              Los plazos comerciales de tramitación en ningún caso deben interpretarse ni presentarse como una limitación o restricción de los derechos que consagra la ley.
            </p>
          </section>

          {/* 6. Reprogramaciones */}
          <section id="reprogramaciones" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">06.</span>
              <h2 className="legal-section-title">Reprogramaciones</h2>
            </div>
            <p>
              Todo cambio de fecha y/o de horario está estrictamente sujeto a la disponibilidad de la agenda general y del profesional seleccionado.
            </p>
            <p>
              Las solicitudes de reprogramación notificadas con al menos <strong>24 horas de anticipación</strong> se gestionarán sin perder la seña abonada, imputándose el importe al nuevo horario acordado. Aquellas solicitudes efectuadas con menor anticipación serán analizadas de buena fe en función de las circunstancias particulares y la factibilidad operativa del salón.
            </p>
          </section>

          {/* 7. Inasistencias */}
          <section id="inasistencias" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">07.</span>
              <h2 className="legal-section-title">Inasistencias</h2>
            </div>
            <p>
              En caso de que el cliente no concurra al turno reservado y no hubiera mediado aviso previo de cancelación con arreglo a estas condiciones, Kani Barber Studio podrá retener el importe de la seña abonada.
            </p>
            <div className="legal-callout">
              <p>
                <strong>Garantía de cobro justo:</strong> En ningún supuesto se cobrará automáticamente al cliente el saldo pendiente por un servicio que no haya sido efectivamente prestado.
              </p>
            </div>
          </section>

          {/* 8. Puntualidad */}
          <section id="puntualidad" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">08.</span>
              <h2 className="legal-section-title">Puntualidad</h2>
            </div>
            <p>
              Se solicita a todos los clientes concurrir con puntualidad en el horario exacto de su cita.
            </p>
            <p>
              Dado que cada turno cuenta con una duración asignada para garantizar la calidad del servicio y respetar a los clientes posteriores, una llegada tardía puede obligar a reducir el alcance del servicio solicitado o requerir la reprogramación de la cita, en caso de que no sea posible realizar el trabajo en el tiempo restante sin perjudicar turnos sucesivos.
            </p>
          </section>

          {/* 9. Derecho de arrepentimiento */}
          <section id="derecho-de-arrepentimiento" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">09.</span>
              <h2 className="legal-section-title">Derecho de arrepentimiento</h2>
            </div>
            <p>
              De conformidad con lo establecido en la <strong>Ley N° 24.240 de Defensa del Consumidor</strong>, el <strong>Código Civil y Comercial de la Nación</strong> y las resoluciones aplicables a las contrataciones a distancia y por medios electrónicos en la República Argentina, el consumidor tiene la facultad de revocar la aceptación del servicio contratado por medios electrónicos dentro de los plazos fijados por la normativa.
            </p>
            <p>
              La política de cancelación previa de 24 horas dispuesta por Kani Barber Studio no debe interpretarse, en caso alguno, como una restricción o menoscabo del derecho legal de arrepentimiento en los supuestos previstos por la legislación vigente.
            </p>
            <div className="legal-callout legal-callout-primary">
              <div className="flex items-start gap-2.5">
                <Scale size={18} className="shrink-0 text-primary mt-0.5" aria-hidden="true" />
                <p>
                  <strong>Mecanismo de solicitud:</strong> Si deseás ejercer el derecho de arrepentimiento legal sobre una seña abonada a distancia, podés solicitarlo comunicándote por correo a <a href="mailto:kanibarberstudio@gmail.com">kanibarberstudio@gmail.com</a> con el asunto <em>«Solicitud de Arrepentimiento — Reserva #[código]»</em>, indicando tus datos para procesar la revocación y reintegro conforme a derecho. Ninguna estipulación de estos términos implicará renuncia a los derechos que amparan a los consumidores.
                </p>
              </div>
            </div>
          </section>

          {/* 10. Responsabilidad y disponibilidad */}
          <section id="responsabilidad-y-disponibilidad" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">10.</span>
              <h2 className="legal-section-title">Responsabilidad y disponibilidad</h2>
            </div>
            <p>
              Kani Barber Studio realiza sus mayores esfuerzos para asegurar la puntualidad y óptima ejecución de los servicios reservados. No obstante, pueden suscitarse contingencias excepcionales, tales como cortes de suministro eléctrico o conectividad, indisponibilidad sobreviniente o enfermedad del profesional asignado, o situaciones de fuerza mayor.
            </p>
            <p>
              En tales supuestos, el estudio se compromete a comunicar la novedad a la mayor brevedad y ofrecer al cliente alternativas razonables de atención con otro barbero de igual calificación, reprogramación prioritaria en el horario más conveniente, o la inmediata devolución de la seña si no fuera factible una solución consensuada.
            </p>
          </section>

          {/* 11. Información del cliente */}
          <section id="informacion-del-cliente" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">11.</span>
              <h2 className="legal-section-title">Información del cliente</h2>
            </div>
            <p>
              El usuario garantiza que los datos brindados durante el proceso de reserva (nombre, apellido, teléfono celular y correo electrónico) son verídicos, exactos y completos. Estos datos resultan indispensables para vincular la reserva, emitir comprobantes de pago, despachar notificaciones operativas e individualizar al titular en el momento de la atención.
            </p>
          </section>

          {/* 12. Protección de datos */}
          <section id="proteccion-de-datos" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">12.</span>
              <h2 className="legal-section-title">Protección de datos personales</h2>
            </div>
            <p>
              La recolección, el resguardo y el tratamiento de los datos personales suministrados por los clientes se rigen en un todo de acuerdo con nuestra{' '}
              <Link to="/politica-de-privacidad" className="font-medium text-gold underline underline-offset-2">
                Política de Privacidad
              </Link>
              , la cual integra y complementa los presentes Términos y Condiciones.
            </p>
          </section>

          {/* 13. Modificaciones de precios y condiciones */}
          <section id="modificaciones-precios" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">13.</span>
              <h2 className="legal-section-title">Modificaciones de precios y condiciones</h2>
            </div>
            <p>
              Kani Barber Studio se reserva el derecho de actualizar los precios de sus servicios y las condiciones comerciales en cualquier momento.
            </p>
            <p>
              Dichas modificaciones entrarán en vigencia desde su publicación en el sitio web para reservas futuras; <strong>bajo ninguna circunstancia se alterarán retroactivamente los precios o condiciones económicas de aquellas reservas que ya se encuentren debidamente confirmadas y señadas</strong> con anterioridad a la modificación tarifaria.
            </p>
          </section>

          {/* 14. Legislación aplicable */}
          <section id="legislacion-aplicable" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">14.</span>
              <h2 className="legal-section-title">Legislación aplicable</h2>
            </div>
            <p>
              Los presentes Términos y Condiciones se rigen e interpretan de conformidad con las leyes de la <strong>República Argentina</strong>, en estricto cumplimiento del régimen tuitivo de defensa del consumidor (Ley 24.240 y concordantes).
            </p>
            <p>
              Para cualquier controversia que pudiera derivarse de la interpretación, validez o cumplimiento de este acuerdo y que no pueda ser resuelta de común acuerdo entre las partes, serán competentes los tribunales ordinarios correspondientes según las reglas de competencia protectorias del consumidor.
            </p>
          </section>

          {/* 15. Contacto */}
          <section id="contacto" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">15.</span>
              <h2 className="legal-section-title">Contacto</h2>
            </div>
            <p>
              Para cualquier duda, solicitud o notificación relacionada con estos Términos y Condiciones, podés contactarnos por los siguientes canales:
            </p>
            <div className="legal-contact-card">
              <div className="legal-contact-row">
                <Building2 size={18} className="legal-contact-icon" aria-hidden="true" />
                <div className="legal-contact-text">
                  <strong>Kani Barber Studio</strong>
                  <br />
                  Estudio de barbería masculina y estilismo profesional
                </div>
              </div>
              <div className="legal-contact-row">
                <MapPin size={18} className="legal-contact-icon" aria-hidden="true" />
                <div className="legal-contact-text">
                  San Isidro Labrador 7, Martínez, Provincia de Buenos Aires, República Argentina.
                </div>
              </div>
              <div className="legal-contact-row">
                <Mail size={18} className="legal-contact-icon" aria-hidden="true" />
                <div className="legal-contact-text">
                  Correo electrónico:{' '}
                  <a href="mailto:kanibarberstudio@gmail.com" className="font-medium text-gold hover:underline">
                    kanibarberstudio@gmail.com
                  </a>
                </div>
              </div>
            </div>
            {/* Marcador interno de cumplimiento legal pendiente de formalización societaria / fiscal */}
          </section>
        </div>

        {/* Navegación y enlaces cruzados al pie */}
        <footer className="legal-footer-nav">
          <Link to="/politica-de-privacidad" className="legal-cross-link">
            <span>Consultar Política de Privacidad →</span>
          </Link>
          <Link to="/reservar-turno" className="legal-back-link">
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Volver a reservar</span>
          </Link>
        </footer>
      </div>
    </main>
  );
}
