import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Building2, Calendar, Mail, MapPin, ShieldCheck } from 'lucide-react';
import { pageHead } from '@/lib/kani-head';
import '@/legal-pages.css';

export const Route = createFileRoute('/politica-de-privacidad')({
  head: () =>
    pageHead(
      'Política de Privacidad',
      'Política de Privacidad de Kani Barber Studio. Tratamiento, resguardo de datos personales y derechos del usuario conforme a la Ley 25.326.',
      'Política de Privacidad · Kani Barber Studio',
    ),
  component: PoliticaDePrivacidadPage,
});

export function PoliticaDePrivacidadPage() {
  return (
    <main className="legal-page" id="contenido-principal">
      <div className="legal-container">
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
          <h1 className="legal-title">Política de Privacidad</h1>
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
            En Kani Barber Studio respetamos tu privacidad y nos comprometemos a proteger la información personal que compartís con nosotros al utilizar nuestro sitio web y nuestro sistema de reservas. Esta política describe con total transparencia cómo recopilamos, utilizamos, protegemos y gestionamos tus datos personales.
          </p>
        </header>

        {/* Índice de navegación rápida */}
        <nav className="legal-toc" aria-label="Índice de la Política de Privacidad">
          <h2 className="legal-toc-title">Índice de secciones</h2>
          <ol className="legal-toc-list">
            <li className="legal-toc-item">
              <a href="#informacion-recopilada">
                <span className="legal-toc-number">01.</span> Información recopilada
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#finalidad">
                <span className="legal-toc-number">02.</span> Finalidad del tratamiento
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#pagos-electronicos">
                <span className="legal-toc-number">03.</span> Pagos electrónicos
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#proteccion-de-datos">
                <span className="legal-toc-number">04.</span> Protección de datos
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#comunicaciones">
                <span className="legal-toc-number">05.</span> Comunicaciones
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#comparticion-de-informacion">
                <span className="legal-toc-number">06.</span> Compartición de información
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#conservacion">
                <span className="legal-toc-number">07.</span> Conservación de datos
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#derechos-del-usuario">
                <span className="legal-toc-number">08.</span> Derechos del usuario (Ley 25.326)
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#cookies">
                <span className="legal-toc-number">09.</span> Cookies y tecnologías técnicas
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#servicios-de-terceros">
                <span className="legal-toc-number">10.</span> Servicios de terceros
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#modificaciones">
                <span className="legal-toc-number">11.</span> Modificaciones a la política
              </a>
            </li>
            <li className="legal-toc-item">
              <a href="#contacto">
                <span className="legal-toc-number">12.</span> Información de contacto
              </a>
            </li>
          </ol>
        </nav>

        {/* Contenido de las 12 secciones */}
        <div className="legal-content">
          {/* 1. Información recopilada */}
          <section id="informacion-recopilada" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">01.</span>
              <h2 className="legal-section-title">Información recopilada</h2>
            </div>
            <p>
              Para gestionar la reserva de turnos y garantizar una adecuada atención en el estudio, Kani Barber Studio podrá recopilar los siguientes datos proporcionados voluntariamente por el usuario:
            </p>
            <ul>
              <li><strong>Nombre y apellido:</strong> para individualizar la reserva y recibirte en el salón.</li>
              <li><strong>Teléfono de contacto:</strong> para coordinar turnos y enviar notificaciones operativas vía WhatsApp o SMS.</li>
              <li><strong>Correo electrónico:</strong> para remitir comprobantes de confirmación, detalles del turno y avisos pertinentes.</li>
              <li><strong>Detalles de la cita:</strong> servicio solicitado, profesional seleccionado, fecha y horario reservados.</li>
              <li><strong>Información de pagos y señas:</strong> estado de la transacción, número de operación y comprobantes provistos por la pasarela de pagos.</li>
              <li><strong>Comunicaciones:</strong> mensajes o consultas enviadas en relación con la solicitud o modificación de reservas.</li>
              <li><strong>Datos técnicos:</strong> dirección IP, identificador técnico de sesión y agente de usuario, estrictamente indispensables para la seguridad, prevención de abusos y estabilidad del servicio web.</li>
            </ul>
          </section>

          {/* 2. Finalidad */}
          <section id="finalidad" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">02.</span>
              <h2 className="legal-section-title">Finalidad</h2>
            </div>
            <p>
              Los datos personales recolectados se utilizan exclusivamente con el propósito de:
            </p>
            <ul>
              <li>Gestionar y registrar la reserva de turnos en nuestra agenda operativa.</li>
              <li>Confirmar turnos, verificar la disponibilidad de los barberos y procesar la acreditación de señas.</li>
              <li>Enviar notificaciones operativas, avisos de reprogramación y recordatorios del turno.</li>
              <li>Responder consultas de atención al cliente y brindar soporte administrativo.</li>
              <li>Prevenir fraudes, duplicación indebida de turnos o accesos no autorizados a la infraestructura.</li>
              <li>Cumplir con las obligaciones legales, impositivas y regulatorias aplicables.</li>
            </ul>
            <div className="legal-callout">
              <p>
                <strong>Compromiso anti-spam:</strong> En Kani Barber Studio no enviamos publicidad comercial, promociones masivas ni comunicaciones de marketing sin tu previo consentimiento expreso e inequívoco.
              </p>
            </div>
          </section>

          {/* 3. Pagos electrónicos */}
          <section id="pagos-electronicos" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">03.</span>
              <h2 className="legal-section-title">Pagos electrónicos</h2>
            </div>
            <p>
              Los pagos online para el abono de la seña requerida se procesan mediante proveedores especializados de pagos digitales homologados, principalmente a través de la plataforma <strong>Payway</strong>.
            </p>
            <p>
              <strong>Kani Barber Studio no almacena ni tiene acceso a los datos completos de las tarjetas bancarias ni de débito o crédito</strong> (número de tarjeta, código de seguridad CVV ni fechas de vencimiento). Toda la captura sensible de datos se efectúa bajo estándares PCI-DSS mediante tokenización y cifrado directo gestionado por el proveedor de pago autorizado.
            </p>
          </section>

          {/* 4. Protección de datos */}
          <section id="proteccion-de-datos" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">04.</span>
              <h2 className="legal-section-title">Protección de datos</h2>
            </div>
            <p>
              Aplicamos medidas técnicas, administrativas y organizativas razonables y actualizadas para resguardar la confidencialidad de los datos personales contra accesos no autorizados, pérdida, alteración, divulgación o destrucción accidental.
            </p>
            <p>
              Nuestra infraestructura tecnológica se apoya en proveedores líderes de la industria que garantizan comunicación cifrada (TLS/HTTPS), almacenamiento seguro en bases de datos con control estricto de acceso por roles y entornos de procesamiento aislados.
            </p>
          </section>

          {/* 5. Comunicaciones */}
          <section id="comunicaciones" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">05.</span>
              <h2 className="legal-section-title">Comunicaciones</h2>
            </div>
            <p>
              Al realizar una reserva en nuestro sitio web, los clientes podrán recibir mensajes informativos mediante correo electrónico y/o WhatsApp exclusivamente relacionados con:
            </p>
            <ul>
              <li>Confirmaciones de reserva y comprobantes de la seña abonada.</li>
              <li>Recordatorios previos a la fecha y hora del turno agendado.</li>
              <li>Modificaciones de horario o profesional acordadas previamente.</li>
              <li>Avisos de cancelación y solicitudes de devolución cuando corresponda.</li>
              <li>Estados y actualizaciones técnicas del procesamiento de pagos.</li>
            </ul>
          </section>

          {/* 6. Compartición de información */}
          <section id="comparticion-de-informacion" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">06.</span>
              <h2 className="legal-section-title">Compartición de información</h2>
            </div>
            <p>
              <strong>Kani Barber Studio no vende, alquila ni comercializa bases de datos personales a terceros bajo ninguna circunstancia.</strong>
            </p>
            <p>
              La información únicamente podrá compartirse con proveedores tecnológicos y prestadores de servicios estrictamente necesarios para el funcionamiento de la plataforma (alojamiento en la nube, procesamiento de cobros electrónicos y despacho de correos o mensajería transaccional), quienes actúan en calidad de encargados de tratamiento bajo obligaciones contractuales de confidencialidad y seguridad. Asimismo, se compartirá información cuando exista un deber u orden judicial o legal válidamente emitida por autoridad competente.
            </p>
          </section>

          {/* 7. Conservación */}
          <section id="conservacion" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">07.</span>
              <h2 className="legal-section-title">Conservación</h2>
            </div>
            <p>
              Los datos personales se conservarán únicamente durante el tiempo estrictamente necesario para cumplir con las finalidades para las que fueron recabados: la gestión integral de la reserva, la atención al cliente, el cumplimiento de las obligaciones contractuales, contables y tributarias exigibles por la legislación argentina, y la resolución de eventuales controversias.
            </p>
          </section>

          {/* 8. Derechos del usuario */}
          <section id="derechos-del-usuario" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">08.</span>
              <h2 className="legal-section-title">Derechos del usuario</h2>
            </div>
            <p>
              En cumplimiento de la <strong>Ley N° 25.326 de Protección de los Datos Personales</strong> de la República Argentina, se hace saber que los titulares de los datos tienen derecho a acceder a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto, así como a solicitar en cualquier momento la rectificación, actualización, confidencialidad o supresión de sus datos personales de nuestros registros.
            </p>
            <p>
              Para ejercer cualquiera de estos derechos, podés enviar una solicitud por escrito a nuestra casilla de contacto: <a href="mailto:kanibarberstudio@gmail.com">kanibarberstudio@gmail.com</a>, indicando tu nombre, correo electrónico y el derecho que deseás ejercer.
            </p>
            <div className="legal-callout legal-callout-primary">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={18} className="shrink-0 text-primary mt-0.5" aria-hidden="true" />
                <p>
                  <strong>Organismo de control:</strong> La <strong>Agencia de Acceso a la Información Pública</strong>, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.
                </p>
              </div>
            </div>
          </section>

          {/* 9. Cookies */}
          <section id="cookies" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">09.</span>
              <h2 className="legal-section-title">Cookies</h2>
            </div>
            <p>
              El sitio web de Kani Barber Studio utiliza únicamente cookies técnicas y almacenamiento local de sesión (sessionStorage / localStorage) estrictamente necesarios para el correcto funcionamiento de la navegación, la selección secuencial de los turnos en el formulario de reserva, la prevención de ataques CSRF y la preservación de preferencias de visualización (como el modo claro u oscuro).
            </p>
            <p>
              <strong>No utilizamos herramientas de publicidad comportamental, redes publicitarias de terceros ni mecanismos de rastreo que no estén debidamente declarados o implementados en nuestra plataforma.</strong>
            </p>
          </section>

          {/* 10. Servicios de terceros */}
          <section id="servicios-de-terceros" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">10.</span>
              <h2 className="legal-section-title">Servicios de terceros</h2>
            </div>
            <p>
              Para ofrecer una experiencia integrada, el sitio interactúa con servicios brindados por terceros:
            </p>
            <ul>
              <li><strong>Google Maps:</strong> para visualizar el mapa interactivo y facilitar la geolocalización de nuestro estudio en San Isidro Labrador 7, Martínez.</li>
              <li><strong>WhatsApp / Meta:</strong> para la atención directa de consultas y coordinación de turnos cuando el cliente inicia o autoriza la conversación.</li>
              <li><strong>Proveedores de pagos (Payway / Prisma Medios de Pago):</strong> para la gestión segura del procesamiento electrónico de cobros y señas.</li>
            </ul>
            <p>
              Dichos servicios operan bajo sus propios términos de servicio y políticas de privacidad, los cuales recomendamos revisar si utilizás sus plataformas.
            </p>
          </section>

          {/* 11. Modificaciones */}
          <section id="modificaciones" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">11.</span>
              <h2 className="legal-section-title">Modificaciones</h2>
            </div>
            <p>
              Kani Barber Studio podrá actualizar o modificar esta Política de Privacidad de forma periódica con el fin de reflejar cambios normativos, mejoras en las medidas de seguridad o adaptaciones en las funcionalidades del servicio. Toda modificación entrará en vigencia a partir de su publicación en este sitio web, consignándose en el encabezado la fecha de la última actualización efectuada.
            </p>
          </section>

          {/* 12. Contacto */}
          <section id="contacto" className="legal-section">
            <div className="legal-section-header">
              <span className="legal-section-number">12.</span>
              <h2 className="legal-section-title">Contacto</h2>
            </div>
            <p>
              Ante cualquier duda, consulta o ejercicio de derechos vinculados a esta Política de Privacidad y el tratamiento de tus datos personales, podés comunicarte directamente con Kani Barber Studio:
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
          <Link to="/terminos-y-condiciones" className="legal-cross-link">
            <span>Consultar Términos y Condiciones →</span>
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
