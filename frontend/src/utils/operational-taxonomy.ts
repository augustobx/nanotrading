/**
 * NanoTrading - Operational Taxonomy & Plain Human Language Mapping
 * 
 * Implements strict separation of entities:
 * 1. ANÁLISIS (Multitemporal market snapshot & bias)
 * 2. ESCENARIO / HIPÓTESIS (Directional or Neutral Observation awaiting zone/breakout)
 * 3. SEÑAL (Authorized by dual AI and technical filters, awaiting entry)
 * 4. OPERACIÓN PAPER (Simulated trade entered, tracking, closed TP/SL)
 */

export const PR41_DEPLOY_TIMESTAMP = 1795294311000; // 2026-11-21 17:51:51 ART (Despliegue commit dd23db1)

export type OperationalCategory =
  | 'EN_PROCESO'
  | 'SENALES_APROBADAS'
  | 'PAPER_TRADING'
  | 'FINALIZADOS_SIN_TRADE'
  | 'HISTORIAL_COMPLETO';

export type LifeStage =
  | 'EN_PROCESO'
  | 'SENAL_AUTORIZADA'
  | 'PAPER_ABIERTO'
  | 'PAPER_CERRADO'
  | 'FINALIZADO_SIN_TRADE';

export type ScenarioType =
  | 'OBSERVACION_NEUTRAL'
  | 'HIPOTESIS_LONG'
  | 'HIPOTESIS_SHORT'
  | 'SENAL_AUTORIZADA'
  | 'TRADE_PAPER';

export type StepperStepId =
  | 'DESCUBIERTO'
  | 'VIGILANDO'
  | 'ZONA_ALCANZADA'
  | 'REEVALUANDO_IA'
  | 'SENAL_APROBADA'
  | 'ENTRADA_PAPER'
  | 'CIERRE';

export interface StepperStep {
  id: StepperStepId;
  label: string;
  sublabel: string;
  status: 'COMPLETED' | 'CURRENT' | 'PENDING' | 'DISCARDED' | 'SKIPPED';
}

export interface ScenarioNarrative {
  humaneCategory: string;
  humaneType: string;
  humaneStatus: string;
  humaneOutcome: string;
  statusColor: 'blue' | 'amber' | 'emerald' | 'rose' | 'slate' | 'purple';
  queEstaPasando: string;
  queEstaEsperando: string;
  queFaltaParaAvanzar: string;
  porQueTermino: string;
  steps: StepperStep[];
  currentStepIndex: number;
  isAlive: boolean;
  hasPaperTrade: boolean;
  isNeutral: boolean;
  isPostFix: boolean;
}

/**
 * Classify a scenario into its core functional category
 */
export function getScenarioCategory(s: any): OperationalCategory {
  const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';
  const status = s.status || '';

  // 1. Paper closed
  if (['COMPLETED_TP', 'COMPLETED_SL'].includes(status)) {
    return 'PAPER_TRADING';
  }
  // 2. Completed neutral observation is finished without trade
  if (status === 'COMPLETED' && isNeutral) {
    return 'FINALIZADOS_SIN_TRADE';
  }
  // 3. Completed directional scenario that had paper trade
  if (status === 'COMPLETED' && !isNeutral) {
    return 'PAPER_TRADING';
  }
  // 4. Paper open
  if (['TRACKING', 'ENTRY_TRIGGERED'].includes(status)) {
    return 'PAPER_TRADING';
  }
  // 5. Approved signals awaiting entry
  if (['ENTRY_VALIDATED', 'ALERT_SENT'].includes(status)) {
    return 'SENALES_APROBADAS';
  }
  // 6. Finished / Discarded without trade
  if (['INVALIDATED', 'EXPIRED', 'CANCELLED', 'NO_TRADE_OBSERVATION'].includes(status)) {
    return 'FINALIZADOS_SIN_TRADE';
  }
  // 7. In progress (monitoring, approaching, in zone, waiting confirmation)
  return 'EN_PROCESO';
}

/**
 * Resolve human operational status
 */
export function getHumanOperationalStatus(s: any): string {
  const status = s.status || '';
  const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';

  switch (status) {
    case 'NO_TRADE_OBSERVATION':
      return 'Vigilando rango neutral (esperando ruptura)';
    case 'COMPLETED':
      return isNeutral
        ? 'Finalizó sin trade (ruptura de rango observada)'
        : 'Operación paper cerrada en Take Profit';
    case 'COMPLETED_TP':
      return 'Operación paper cerrada en Take Profit (+XR)';
    case 'COMPLETED_SL':
      return 'Operación paper cerrada en Stop Loss (-1R)';
    case 'APPROACHING_ZONE':
      return 'Aproximándose a zona operativa (≤0.35%)';
    case 'IN_ZONE':
    case 'REVALIDATION_REQUESTED':
      return 'Precio en zona · Pendiente revalidación IA';
    case 'AI_REVALIDATING':
      return 'Revalidando con OpenAI & Gemini';
    case 'WAITING_CONFIRMATION':
      return 'Esperando confirmación de ruptura en vela';
    case 'ENTRY_VALIDATED':
    case 'ALERT_SENT':
      return 'Señal autorizada · Esperando tick de entrada';
    case 'ENTRY_TRIGGERED':
      return 'Entrada paper ejecutada · Iniciando tracking';
    case 'TRACKING':
      return 'Entrada paper ejecutada · En tracking activo';
    case 'INVALIDATED':
      return s.rejectionReason
        ? `Invalidado: ${s.rejectionReason}`
        : 'Invalidado por estructura contraria / stop';
    case 'EXPIRED':
      return 'Expiró sin confirmación (tiempo límite)';
    case 'CANCELLED':
      return s.rejectionReason
        ? `Cancelado por IA: ${s.rejectionReason}`
        : 'Cancelado por cambio de estructura o riesgo';
    case 'SCENARIO_REGISTERED':
    case 'SCENARIO_MONITORING':
    default:
      return isNeutral
        ? 'Vigilando consolidación de rango 24/7'
        : 'Vigilando zona operativa (esperando precio)';
  }
}

/**
 * Resolve human final outcome
 */
export function getHumanOutcome(s: any): string {
  const status = s.status || '';
  const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';

  if (status === 'COMPLETED_TP') return 'Trade paper cerrado en Take Profit (+)';
  if (status === 'COMPLETED_SL') return 'Trade paper cerrado en Stop Loss (-)';
  if (status === 'COMPLETED' && !isNeutral) return 'Trade paper cerrado en Take Profit';
  if (status === 'COMPLETED' && isNeutral) return 'Observación finalizada · 0 USDT arriesgados (Ruptura observada)';
  if (['TRACKING', 'ENTRY_TRIGGERED'].includes(status)) return 'Trade paper abierto en curso';
  if (['ENTRY_VALIDATED', 'ALERT_SENT'].includes(status)) return 'Señal aprobada · Esperando entrada de mercado';
  if (status === 'INVALIDATED') return 'Sin trade · Descartado por invalidación técnica previa';
  if (status === 'EXPIRED') return 'Sin trade · Expirado sin alcanzar mitigación';
  if (status === 'CANCELLED') return 'Sin trade · Cancelado por filtro de riesgo o IA';
  if (status === 'NO_TRADE_OBSERVATION') return 'Sin trade · Observación cualitativa activa';
  return 'En vigilancia algorítmica activa (sin trade iniciado)';
}

/**
 * Build a complete, comprehensive human narrative for any scenario
 */
export function getScenarioNarrative(s: any): ScenarioNarrative {
  const isPostFix = (s.discoveryTimestamp || 0) >= PR41_DEPLOY_TIMESTAMP;
  const isNeutral = s.direction === 'NEUTRAL' || s.kind === 'NEUTRAL_OBSERVATION';
  const status = s.status || '';

  const humaneStatus = getHumanOperationalStatus(s);
  const humaneOutcome = getHumanOutcome(s);

  let humaneCategory = 'Hipótesis Direccional';
  let humaneType = s.direction === 'LONG' ? 'Hipótesis LONG' : s.direction === 'SHORT' ? 'Hipótesis SHORT' : 'Observación Neutral';
  if (isNeutral) humaneCategory = 'Observación Cualitativa';

  let statusColor: 'blue' | 'amber' | 'emerald' | 'rose' | 'slate' | 'purple' = 'blue';

  let queEstaPasando = '';
  let queEstaEsperando = '';
  let queFaltaParaAvanzar = '';
  let porQueTermino = '';

  const isAlive = !['INVALIDATED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status);
  const hasPaperTrade = ['TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status);

  // 1. NEUTRAL OBSERVATION
  if (isNeutral) {
    statusColor = isAlive ? 'amber' : 'slate';
    queEstaPasando = `El sistema detectó un rango de consolidación en ${s.timeframe || '15m'} sin ventaja estadística direccional.`;

    if (status === 'COMPLETED') {
      queEstaEsperando = 'Ninguna. La observación concluyó exitosamente.';
      queFaltaParaAvanzar = 'Completado.';
      porQueTermino = 'Ruptura confirmada de rango con vela cerrada. El watcher detectó salida del rango y disparó nuevo ciclo de análisis sin arriesgar capital.';
    } else {
      queEstaEsperando = `Ruptura del techo ($${s.entryZoneMax?.toFixed(1) || '---'}) o piso ($${s.entryZoneMin?.toFixed(1) || '---'}) con volumen en vela cerrada.`;
      queFaltaParaAvanzar = 'Cierre de vela de 15m/1h por fuera de los límites de consolidación.';
      porQueTermino = isAlive ? 'Sigue viva y bajo vigilancia continua.' : (s.rejectionReason || 'Vigencia agotada.');
    }
  }
  // 2. DIRECTIONAL SCENARIO
  else {
    if (['COMPLETED_TP', 'COMPLETED_SL', 'COMPLETED'].includes(status)) {
      statusColor = status === 'COMPLETED_SL' ? 'rose' : 'emerald';
      queEstaPasando = 'La operación simulada de paper trading ha concluido su ciclo completo de mercado.';
      queEstaEsperando = 'Ninguna. Trade finalizado y archivado.';
      queFaltaParaAvanzar = 'Operación terminada.';
      porQueTermino = status === 'COMPLETED_SL'
        ? `Cierre por Stop Loss ejecutado a $${s.stopLossPrice?.toFixed(1) || '---'} (-1R de riesgo controlado).`
        : `Cierre por Take Profit ejecutado a $${s.target14Price?.toFixed(1) || s.target12Price?.toFixed(1) || '---'} con ganancia neta.`;
    } else if (['TRACKING', 'ENTRY_TRIGGERED'].includes(status)) {
      statusColor = 'emerald';
      humaneType = 'Operación Paper Abierta';
      queEstaPasando = `Posición virtual ${s.direction} en seguimiento activo. El precio alcanzó el nivel de entrada programado.`;
      queEstaEsperando = `Evolución del precio hacia TP ($${s.target14Price?.toFixed(1) || '---'}) o protección por SL ($${s.stopLossPrice?.toFixed(1) || '---'}).`;
      queFaltaParaAvanzar = 'Toque del objetivo o del stop estructural.';
      porQueTermino = 'Posición actualmente viva en seguimiento 24/7.';
    } else if (['ENTRY_VALIDATED', 'ALERT_SENT'].includes(status)) {
      statusColor = 'emerald';
      humaneType = 'Señal Aprobada';
      queEstaPasando = 'La hipótesis fue aprobada por OpenAI y Gemini con R:R neto calificado. Señal autorizada.';
      queEstaEsperando = `Esperando que el precio de mercado toque la zona de entrada [$${s.entryZoneMin?.toFixed(1)} - $${s.entryZoneMax?.toFixed(1)}].`;
      queFaltaParaAvanzar = 'Tick de cotización dentro de la zona para ejecutar la entrada paper.';
      porQueTermino = 'Aún no termina. Esperando ejecución de entrada o caducidad temporal.';
    } else if (['IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING'].includes(status)) {
      statusColor = 'purple';
      queEstaPasando = 'El precio tocó la zona operativa identificada. El sistema está consultando a las IA con el snapshot actual.';
      queEstaEsperando = 'Respuesta estructurada de OpenAI y Gemini sobre si el setup mantiene confluencia y R:R neto ≥ 1:4.';
      queFaltaParaAvanzar = 'Doble consenso afirmativo de las IA y verificación de spread L2.';
      porQueTermino = 'Sigue en revalidación.';
    } else if (status === 'APPROACHING_ZONE') {
      statusColor = 'amber';
      queEstaPasando = `El precio se encuentra a menos del 0.35% de la zona de entrada (${s.distanceToZonePct !== undefined ? s.distanceToZonePct.toFixed(2) + '%' : 'muy cerca'}).`;
      queEstaEsperando = 'Toque definitivo del nivel de entrada para gatillar la revalidación.';
      queFaltaParaAvanzar = 'Avanzar la distancia restante hacia la zona.';
      porQueTermino = 'Sigue viva en aproximación.';
    } else if (['INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(status)) {
      statusColor = status === 'EXPIRED' ? 'slate' : 'rose';
      queEstaPasando = 'El escenario fue finalizado y archivado sin llegar a ejecutar ninguna operación comercial ni paper trade.';
      queEstaEsperando = 'Ninguna. Escenario cerrado.';
      queFaltaParaAvanzar = 'Ninguna acción posible. Ya fue descartado.';
      porQueTermino = status === 'INVALIDATED'
        ? `Invalidación técnica: ${s.rejectionReason || 'El precio quebró el nivel de invalidación estructural o stop antes de mitigar la zona.'}`
        : status === 'EXPIRED'
        ? 'Expiración por tiempo: Se agotó la ventana temporal válida sin que el mercado alcanzara la zona.'
        : `Cancelación por IA o riesgo: ${s.rejectionReason || 'Falta de confluencia o riesgo no admisible.'}`;
    } else {
      statusColor = 'blue';
      queEstaPasando = `Hipótesis ${s.direction} descubierta para ${s.timeframe || '15m'} basada en ${s.structureType || 'SMC'}.`;
      queEstaEsperando = `Esperando que el precio se aproxime a la zona [$${s.entryZoneMin?.toFixed(1)} - $${s.entryZoneMax?.toFixed(1)}].`;
      queFaltaParaAvanzar = 'Aproximación del precio a ≤ 0.35% de distancia.';
      porQueTermino = 'Sigue viva en vigilancia 24/7.';
    }
  }

  // 3. BUILD 7-STEP PROGRESSION STEPPER
  // Descubierto -> Vigilando -> Zona -> Revalidando -> Señal -> Entrada -> Cierre
  const steps: StepperStep[] = [
    {
      id: 'DESCUBIERTO',
      label: '1. Descubierto',
      sublabel: isNeutral ? 'Rango identificado' : `${s.direction} detectado`,
      status: 'COMPLETED',
    },
    {
      id: 'VIGILANDO',
      label: '2. Vigilando',
      sublabel: 'Watcher 24/7 sin IA',
      status: ['SCENARIO_REGISTERED', 'SCENARIO_MONITORING'].includes(status)
        ? 'CURRENT'
        : ['APPROACHING_ZONE', 'IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING', 'WAITING_CONFIRMATION', 'ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : status === 'EXPIRED'
        ? 'DISCARDED'
        : 'COMPLETED',
    },
    {
      id: 'ZONA_ALCANZADA',
      label: '3. Zona Alcanzada',
      sublabel: isNeutral ? 'Ruptura monitoreada' : 'Precio en mitigación',
      status: ['APPROACHING_ZONE', 'WAITING_CONFIRMATION'].includes(status)
        ? 'CURRENT'
        : ['IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING', 'ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : ['INVALIDATED', 'CANCELLED', 'EXPIRED'].includes(status)
        ? 'DISCARDED'
        : 'PENDING',
    },
    {
      id: 'REEVALUANDO_IA',
      label: '4. Revalidación IA',
      sublabel: 'OpenAI + Gemini',
      status: ['IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING'].includes(status)
        ? 'CURRENT'
        : ['ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : isNeutral && status === 'COMPLETED'
        ? 'SKIPPED'
        : ['INVALIDATED', 'CANCELLED'].includes(status)
        ? 'DISCARDED'
        : 'PENDING',
    },
    {
      id: 'SENAL_APROBADA',
      label: '5. Señal Aprobada',
      sublabel: 'R:R ≥ 1:4 verificado',
      status: ['ENTRY_VALIDATED', 'ALERT_SENT'].includes(status)
        ? 'CURRENT'
        : ['TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : isNeutral
        ? 'SKIPPED'
        : ['INVALIDATED', 'CANCELLED'].includes(status)
        ? 'DISCARDED'
        : 'PENDING',
    },
    {
      id: 'ENTRADA_PAPER',
      label: '6. Entrada Paper',
      sublabel: 'Simulada en mercado',
      status: ['ENTRY_TRIGGERED', 'TRACKING'].includes(status)
        ? 'CURRENT'
        : ['COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : isNeutral
        ? 'SKIPPED'
        : 'PENDING',
    },
    {
      id: 'CIERRE',
      label: '7. Cierre',
      sublabel: isNeutral ? 'Observación fin' : status === 'COMPLETED_SL' ? 'Stop Loss' : 'Take Profit',
      status: ['COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)
        ? 'COMPLETED'
        : 'PENDING',
    },
  ];

  let currentStepIndex = 1;
  const currIdx = steps.findIndex((st) => st.status === 'CURRENT');
  if (currIdx !== -1) {
    currentStepIndex = currIdx;
  } else {
    const compIdx = steps.map((st) => st.status).lastIndexOf('COMPLETED');
    currentStepIndex = compIdx !== -1 ? compIdx : 0;
  }

  return {
    humaneCategory,
    humaneType,
    humaneStatus,
    humaneOutcome,
    statusColor,
    queEstaPasando,
    queEstaEsperando,
    queFaltaParaAvanzar,
    porQueTermino,
    steps,
    currentStepIndex,
    isAlive,
    hasPaperTrade,
    isNeutral,
    isPostFix,
  };
}

export interface FunnelMetrics {
  totalScenarios: number;
  neutralObservations: number;
  directionalScenarios: number;
  zonesReached: number;
  revalidationsTriggered: number;
  signalsApproved: number;
  paperEntriesExecuted: number;
  paperClosedTp: number;
  paperClosedSl: number;
  discardedWithoutTrade: number;
}

/**
 * Calculate the full operational pipeline funnel
 */
export function calculateFunnelMetrics(scenarios: any[], signals: any[] = []): FunnelMetrics {
  const totalScenarios = scenarios.length;
  const neutralObservations = scenarios.filter(
    (s) => s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL'
  ).length;
  const directionalScenarios = totalScenarios - neutralObservations;

  const zonesReached = scenarios.filter((s) =>
    ['IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING', 'ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL', 'COMPLETED'].includes(s.status)
  ).length;

  const revalidationsTriggered = scenarios.filter((s) =>
    ['REVALIDATION_REQUESTED', 'AI_REVALIDATING', 'ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(s.status)
  ).length;

  const signalsApproved = scenarios.filter((s) =>
    ['ENTRY_VALIDATED', 'ALERT_SENT', 'TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(s.status)
  ).length;

  // Real paper entries with simulatedEntryTime
  const paperEntriesFromSignals = signals.filter((sig) => !!sig.simulatedEntryTime).length;
  const paperEntriesFromScenarios = scenarios.filter((s) =>
    ['TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(s.status)
  ).length;
  const paperEntriesExecuted = Math.max(paperEntriesFromSignals, paperEntriesFromScenarios);

  const paperClosedTp = signals.filter((s) => (s.state || s.status) === 'COMPLETED_TP').length;
  const paperClosedSl = signals.filter((s) => (s.state || s.status) === 'COMPLETED_SL').length;

  const discardedWithoutTrade = scenarios.filter((s) =>
    ['INVALIDATED', 'EXPIRED', 'CANCELLED', 'NO_TRADE_OBSERVATION'].includes(s.status) ||
    (s.status === 'COMPLETED' && (s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL'))
  ).length;

  return {
    totalScenarios,
    neutralObservations,
    directionalScenarios,
    zonesReached,
    revalidationsTriggered,
    signalsApproved,
    paperEntriesExecuted,
    paperClosedTp,
    paperClosedSl,
    discardedWithoutTrade,
  };
}
