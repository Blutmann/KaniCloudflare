import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Database,
  Layers3,
  LockKeyhole,
  Mail,
  Menu,
  MoveRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { pageHead } from "@/lib/kani-head";
import "../case-study.css";

export const Route = createFileRoute("/case-study")({
  head: () =>
    pageHead(
      "Caso de estudio Product Design",
      "Caso de estudio de Kani Barber Studio: diseño y construcción de una experiencia real de reservas.",
      "Kani Barber Studio — Product Design Case Study",
    ),
  component: CaseStudyPage,
});

const evidenceLabels = {
  verified: "Implementado y verificado",
  documented: "Decisión documentada",
  reconstructed: "Reconstrucción desde la implementación",
  pending: "Pendiente de validación",
} as const;

function EvidenceTag({ kind }: { kind: keyof typeof evidenceLabels }) {
  return <span className={`case-study-evidence case-study-evidence-${kind}`}>{evidenceLabels[kind]}</span>;
}

function CaseStudyPage() {
  return (
    <main className="case-study-page">
      <div className="case-study-progress" aria-hidden="true">
        <span />
      </div>

      <section className="case-study-hero case-study-container">
        <div className="case-study-hero-copy">
          <p className="case-study-kicker">Product Design · Producto web real</p>
          <h1>Kani<br /><em>Barber Studio</em></h1>
          <p className="case-study-hero-lead">
            Diseñar y construir una experiencia de reservas que conecte las necesidades del cliente con la operación diaria de una barbería real.
          </p>
          <div className="case-study-hero-actions">
            <a className="case-study-button case-study-button-primary" href="https://www.kanibarber.com" target="_blank" rel="noreferrer">
              Ver producto <ArrowUpRight size={16} />
            </a>
            <a className="case-study-text-link" href="#contexto">Leer el caso <MoveRight size={15} /></a>
          </div>
        </div>
        <div className="case-study-hero-visual">
          <div className="case-study-window-bar"><span /><span /><span /><small>kanibarber.com/reservar</small></div>
          <img src="/case-study/booking-step-1.png" alt="Captura real del primer paso de solicitud de turno de Kani Barber Studio" />
          <p>Captura real de Preview · primer paso del flujo de solicitud</p>
        </div>
      </section>

      <section className="case-study-meta-strip">
        <div className="case-study-container case-study-meta-grid">
          <MetaItem label="Rol" value="Definición de producto, UX/UI y desarrollo asistido por IA" />
          <MetaItem label="Contexto" value="Proyecto independiente para un negocio real" />
          <MetaItem label="Stack" value="Manus · React · Supabase · Resend" />
          <MetaItem label="Estado" value="Publicado; alcance técnico documentado" />
        </div>
      </section>

      <section id="contexto" className="case-study-section case-study-container case-study-split-section">
        <SectionIntro number="01" eyebrow="Contexto y problema" title="No era solo elegir un horario." />
        <div className="case-study-copy-block">
          <p className="case-study-display-copy">El desafío era convertir una operación con agendas individuales, solicitudes pendientes y clientes sin turno en una experiencia que pudiera entenderse y gestionarse.</p>
          <p>La interfaz pública debía ser simple. Detrás, el producto necesitaba resolver restricciones reales: qué barbero atiende, cuánto dura cada servicio, qué horarios están bloqueados y qué significa exactamente «solicitar» un turno.</p>
          <div className="case-study-callout"><Sparkles size={18} /><span>La tesis del proyecto: la claridad de la experiencia depende de que la lógica operativa y la comunicación de estados estén diseñadas juntas.</span></div>
        </div>
      </section>

      <section className="case-study-section case-study-container">
        <div className="case-study-section-heading"><p className="case-study-kicker">Necesidades operativas conocidas</p><h2>Tres personas, tres definiciones de éxito.</h2></div>
        <div className="case-study-person-grid">
          <PersonCard number="01" title="Cliente" icon={<Sparkles size={20} />} goal="Solicitar un turno sin adivinar qué ocurre después." need="Elegir servicio, barbero, fecha y horario; completar datos; comprender la seña y la confirmación." question="¿La diferencia entre solicitud y turno confirmado queda clara?" />
          <PersonCard number="02" title="Barbero" icon={<Clock3 size={20} />} goal="Trabajar con su propia agenda y responder solicitudes." need="Consultar turnos permitidos, actualizar estados y gestionar disponibilidad sin invadir otra agenda." question="¿Puede actuar rápido sin perder contexto operativo?" />
          <PersonCard number="03" title="Administrador" icon={<ShieldCheck size={20} />} goal="Supervisar la operación completa y mantener el sistema ordenado." need="Ver las tres agendas, administrar disponibilidad, controlar permisos y revisar actividad." question="¿La vista general conserva suficiente control sin sumar complejidad?" />
        </div>
        <p className="case-study-footnote"><CircleAlert size={14} /> Estos perfiles representan necesidades operativas conocidas e hipótesis de diseño. No sustituyen entrevistas ni tests formales con usuarios.</p>
      </section>

      <section className="case-study-section case-study-section-dark">
        <div className="case-study-container">
          <div className="case-study-section-heading"><p className="case-study-kicker">Decisiones de diseño</p><h2>Diseñar la confianza detrás del botón.</h2><p>Las decisiones más importantes no fueron decorativas: redujeron ambigüedad entre la promesa de la interfaz y las reglas que realmente sostienen una reserva.</p></div>
          <div className="case-study-challenge-list">
            <Challenge number="01" icon={<Database size={21} />} title="Disponibilidad confiable" problem="Un horario libre visualmente no garantiza que pueda ocuparse durante todo el servicio." decision="La disponibilidad pública se unifica con la duración efectiva del servicio, reservas no canceladas y bloqueos por agenda. La validación final ocurre en la capa de negocio, no solo en la tarjeta visual." evidence="RPC de disponibilidad unificada, validación de duración real y exclusión de horarios ocupados." status="verified" next="Probar integralmente escenarios concurrentes con datos controlados." />
            <Challenge number="02" icon={<Mail size={21} />} title="Solicitud frente a confirmación" problem="Enviar una solicitud no equivale a tener un turno confirmado." decision="El recorrido separa estados, comunica que la solicitud fue recibida y explica el paso de la seña. Las notificaciones funcionan como resumen y acceso a la acción, no como una pantalla paralela." evidence="Estados PENDING / CONFIRMED / CANCELLED, textos de confirmación y outbox transaccional." status="documented" next="Validar comprensión de la seña y del estado con clientes reales." />
            <Challenge number="03" icon={<LockKeyhole size={21} />} title="Permisos sin fricción" problem="Cada barbero necesita su agenda; ADMIN necesita una visión completa." decision="El producto separa el alcance por rol y barbero. La restricción se aplica en consultas, políticas y funciones, no únicamente en la interfaz." evidence="BARBER limitado a su barber_id; ADMIN con acceso a las tres agendas; RLS y RPCs de negocio." status="verified" next="Ejecutar pruebas de autorización con cuentas aisladas y escenarios de URL manipulada." />
            <Challenge number="04" icon={<Layers3 size={21} />} title="Simplificar el recorrido" problem="Una operación compleja no puede trasladarse completa al cliente." decision="El flujo público se estructura en seis pasos, con una acción principal visible, estados progresivos y copy directo. La estética editorial acompaña la lectura sin competir con la tarea." evidence="Servicio → Barbero → Fecha → Horario → Datos → Resumen; responsive y estados de selección." status="reconstructed" next="Medir abandono por etapa y detectar puntos de confusión." />
          </div>
        </div>
      </section>

      <section className="case-study-section case-study-container">
        <SectionIntro number="02" eyebrow="La experiencia" title="Un recorrido corto en pantalla, una operación completa detrás." />
        <div className="case-study-flow" aria-label="Flujo de solicitud de turno en seis pasos">
          {['Servicio', 'Barbero', 'Fecha', 'Horario', 'Tus datos', 'Resumen'].map((step, index) => <div className="case-study-flow-step" key={step}><span>0{index + 1}</span><strong>{step}</strong>{index < 5 && <MoveRight size={16} />}</div>)}
        </div>
        <div className="case-study-evidence-layout">
          <div className="case-study-evidence-copy"><EvidenceTag kind="verified" /><h3>La interfaz reduce la carga de decisión.</h3><p>La selección se divide en unidades pequeñas y el resumen final reúne servicio, barbero, fecha, horario, importe total y seña. El cliente no necesita comprender la base de datos para saber qué está solicitando.</p><ul className="case-study-check-list"><li><Check size={15} /> Duraciones comerciales integradas al cálculo</li><li><Check size={15} /> Disponibilidad contextual por barbero</li><li><Check size={15} /> Confirmación posterior diferenciada</li></ul></div>
          <figure className="case-study-image-card"><img src="/case-study/contacto-real.png" alt="Captura real de la página de contacto de Kani Barber Studio" /><figcaption>Otra pantalla real del producto: contacto, ubicación y horarios. Se utiliza como evidencia del sistema visual, no como mockup.</figcaption></figure>
        </div>
      </section>

      <section className="case-study-section case-study-section-paper">
        <div className="case-study-container">
          <div className="case-study-section-heading"><p className="case-study-kicker">Proceso e iteraciones</p><h2>El producto se volvió más específico a medida que aparecieron las restricciones.</h2><p>Cuando no existe una captura histórica, el cambio se describe como estado previo documentado o reconstrucción desde el historial y la implementación.</p></div>
          <div className="case-study-timeline">
            <TimelineItem phase="MVP" title="De una reserva lineal a una solicitud comprensible" before="El recorrido necesitaba comunicar más que una selección de fecha y hora." after="Se estructuró en seis pasos y se separó la solicitud de la confirmación." reason="Hacer visible el estado real del proceso y reducir ambigüedad." tag="documented" />
            <TimelineItem phase="Operación" title="De una agenda general a agendas con alcance" before="La operación requería administrar tres agendas sin mezclar responsabilidades." after="Se eliminó «Todos los barberos» de Gestión de horarios y se forzó el contexto individual." reason="Reducir errores de operación y reforzar el aislamiento por rol." tag="documented" />
            <TimelineItem phase="Reglas" title="De slots visibles a disponibilidad por duración" before="Un slot disponible podía no alcanzar para el servicio elegido." after="La disponibilidad se calcula por inicios válidos, duración efectiva, bloqueos y reservas." reason="Alinear la promesa visual con la validación real del negocio." tag="reconstructed" />
          </div>
        </div>
      </section>

      <section className="case-study-section case-study-container">
        <div className="case-study-results-grid">
          <div><p className="case-study-kicker">Qué se construyó</p><h2>Un producto operativo, no una demo aislada.</h2><p>La versión actual reúne una experiencia pública de solicitud, un panel de staff con roles, disponibilidad por agenda, reglas de duración y notificaciones transaccionales integradas a la operación.</p></div>
          <div className="case-study-result-list"><ResultRow label="Implementado" value="Flujo público, panel de staff, roles, disponibilidad y estados." /><ResultRow label="Verificado técnicamente" value="TypeScript, tests existentes, build, rutas HTTP y lecturas de esquema." /><ResultRow label="Pendiente de prueba integral" value="Usabilidad, entrega real de emails, concurrencia y recorridos completos de modificación/cancelación." /><ResultRow label="No medido todavía" value="Conversión, abandono, satisfacción, ahorro de tiempo e impacto comercial." /></div>
        </div>
      </section>

      <section className="case-study-section case-study-section-dark">
        <div className="case-study-container case-study-limitations-grid">
          <div><p className="case-study-kicker">Límites y próximos pasos</p><h2>La evidencia también diseña el próximo experimento.</h2></div>
          <div className="case-study-next-steps"><NextStep priority="Alta" title="Validar comprensión" text="Observar si clientes distinguen solicitud, confirmación y seña sin explicación adicional." /><NextStep priority="Alta" title="Probar operación real" text="Acompañar a barberos y ADMIN en una jornada con turnos reales y clientes sin turno." /><NextStep priority="Media" title="Instrumentar el recorrido" text="Medir finalización y abandono por paso, horarios rechazados y tiempo de resolución." /><NextStep priority="Media" title="Cerrar cobertura" text="Completar pruebas de accesibilidad, responsive y escenarios de cancelación/modificación." /></div>
        </div>
      </section>

      <section className="case-study-section case-study-container case-study-reflection">
        <p className="case-study-kicker">Reflexión profesional</p>
        <blockquote>El aprendizaje más concreto fue que una decisión de UX deja de ser superficial cuando tiene que sostener una regla de negocio. Diseñar el mensaje de «solicitud» exigió entender estados, permisos, disponibilidad, persistencia y operación; y diseñar la disponibilidad exigió aceptar que una interfaz clara necesita una validación de servidor igualmente clara.</blockquote>
        <p>El proyecto también hizo visible el límite de la evidencia: una aplicación puede estar publicada y técnicamente consistente sin que eso pruebe todavía que el recorrido sea fácil para todos. El siguiente paso no es agregar funciones por agregar, sino observar, medir y volver a decidir.</p>
      </section>

      <section className="case-study-closing case-study-container">
        <div><p className="case-study-kicker">Kani Barber Studio</p><h2>Diseñar para que la operación también pueda respirar.</h2></div>
        <div className="case-study-closing-links"><a href="https://www.kanibarber.com" target="_blank" rel="noreferrer">Producto publicado <ArrowUpRight size={16} /></a><Link to="/">Volver al inicio <MoveRight size={16} /></Link></div>
      </section>

      <div className="case-study-disclaimer case-study-container"><Menu size={14} /> Caso de estudio profesional independiente · Evidencia revisada en octubre de 2026 · Sin datos personales ni credenciales</div>
    </main>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return <div className="case-study-meta-item"><span>{label}</span><strong>{value}</strong></div>;
}

function SectionIntro({ number, eyebrow, title }: { number: string; eyebrow: string; title: string }) {
  return <div className="case-study-section-intro"><span className="case-study-section-number">{number}</span><div><p className="case-study-kicker">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function PersonCard({ number, title, icon, goal, need, question }: { number: string; title: string; icon: React.ReactNode; goal: string; need: string; question: string }) {
  return <article className="case-study-person-card"><div className="case-study-card-top"><span>{number}</span><span className="case-study-icon">{icon}</span></div><h3>{title}</h3><p className="case-study-card-goal">{goal}</p><p>{need}</p><div className="case-study-question">{question}</div></article>;
}

function Challenge({ number, icon, title, problem, decision, evidence, status, next }: { number: string; icon: React.ReactNode; title: string; problem: string; decision: string; evidence: string; status: keyof typeof evidenceLabels; next: string }) {
  return <article className="case-study-challenge"><div className="case-study-challenge-title"><span>{number}</span><span className="case-study-icon">{icon}</span><h3>{title}</h3></div><div className="case-study-challenge-body"><div><small>Problema</small><p>{problem}</p></div><div><small>Decisión adoptada</small><p>{decision}</p></div><div><small>Evidencia</small><p>{evidence}</p></div><div className="case-study-challenge-footer"><EvidenceTag kind={status} /><span><strong>Próximo paso:</strong> {next}</span></div></div></article>;
}

function TimelineItem({ phase, title, before, after, reason, tag }: { phase: string; title: string; before: string; after: string; reason: string; tag: keyof typeof evidenceLabels }) {
  return <article className="case-study-timeline-item"><div className="case-study-timeline-marker"><span>{phase}</span></div><div className="case-study-timeline-content"><EvidenceTag kind={tag} /><h3>{title}</h3><div className="case-study-before-after"><div><small>Antes / estado previo</small><p>{before}</p></div><MoveRight size={18} /><div><small>Después / estado actual</small><p>{after}</p></div></div><p className="case-study-reason"><strong>Motivo:</strong> {reason}</p></div></article>;
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return <div className="case-study-result-row"><span>{label}</span><p>{value}</p></div>;
}

function NextStep({ priority, title, text }: { priority: string; title: string; text: string }) {
  return <div className="case-study-next-step"><span>{priority}</span><div><h3>{title}</h3><p>{text}</p></div></div>;
}
