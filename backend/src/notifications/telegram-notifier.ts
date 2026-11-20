import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';
import { SignalInstance } from '../engine/signal-state-machine.js';

export interface TelegramMessageOptions {
  parseMode?: 'HTML' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
}

export class TelegramNotifier {
  private botToken?: string;
  private chatId?: string;
  private enabled: boolean;
  private db: DatabaseService;
  private dedupCache: Map<string, number> = new Map();
  private readonly dedupWindowMs: number = 60000; // 60s deduplication window

  constructor(db: DatabaseService, botToken?: string, chatId?: string, enabled?: boolean) {
    this.db = db;
    this.botToken = botToken ?? config.telegram.botToken;
    this.chatId = chatId ?? config.telegram.chatId;
    this.enabled = enabled ?? config.telegram.enabled;
  }

  public isConfigured(): boolean {
    return Boolean(this.enabled && this.botToken && this.chatId);
  }

  public async sendMessage(
    text: string,
    messageType: string = 'ALERT',
    signalId?: string,
    options: TelegramMessageOptions = { parseMode: 'HTML', disableWebPagePreview: true }
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    const logId = `tg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();

    // Deduplication check
    const dedupKey = `${messageType}_${signalId || text.substring(0, 30)}`;
    const lastSent = this.dedupCache.get(dedupKey);
    if (lastSent && now - lastSent < this.dedupWindowMs) {
      this.db.logNotification({
        id: logId,
        channel: 'TELEGRAM',
        recipient: this.chatId || 'UNCONFIGURED',
        signalId,
        messageType,
        payload: { text, dedup: true },
        status: 'DEDUPLICATED',
        timestamp: now,
      });
      return { success: true };
    }

    if (!this.isConfigured()) {
      this.db.logNotification({
        id: logId,
        channel: 'TELEGRAM',
        recipient: this.chatId || 'UNCONFIGURED',
        signalId,
        messageType,
        payload: { text },
        status: 'SKIPPED_NOT_CONFIGURED',
        timestamp: now,
      });
      return { success: false, error: 'Telegram no configurado o deshabilitado' };
    }

    // Call Telegram API with retry
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: options.disableWebPagePreview !== false,
    };

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data: any = await response.json();
        if (data.ok) {
          this.dedupCache.set(dedupKey, now);
          this.db.logNotification({
            id: logId,
            channel: 'TELEGRAM',
            recipient: this.chatId!,
            signalId,
            messageType,
            payload: { text, telegramMessageId: data.result?.message_id },
            status: 'DELIVERED',
            deliveredAt: Date.now(),
            timestamp: now,
          });
          return { success: true, messageId: data.result?.message_id };
        } else {
          lastError = `Telegram API error: ${data.description || 'Unknown error'}`;
        }
      } catch (err: any) {
        lastError = `Network error on attempt ${attempt}: ${err.message}`;
      }

      // Backoff before retry
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }

    this.db.logNotification({
      id: logId,
      channel: 'TELEGRAM',
      recipient: this.chatId!,
      signalId,
      messageType,
      payload: { text, error: lastError },
      status: 'FAILED',
      timestamp: now,
    });

    return { success: false, error: lastError };
  }

  public async notifySignalValidated(signal: SignalInstance): Promise<void> {
    const dirEmoji = signal.direction === 'LONG' ? '🟢' : '🔴';
    const msg = [
      `<b>⚡ NANOLABS AI TRADING — SEÑAL AUTORIZADA</b>`,
      ``,
      `${dirEmoji} <b>Dirección:</b> ${signal.direction} #${signal.symbol}`,
      `📐 <b>Estrategia:</b> ${signal.strategy}`,
      `⏱ <b>Temporalidad:</b> ${signal.timeframe}`,
      ``,
      `🎯 <b>Entrada:</b> <code>$${signal.entryPrice.toFixed(2)}</code>`,
      `🛑 <b>Stop Loss:</b> <code>$${signal.stopLossPrice.toFixed(2)}</code>`,
      `🏆 <b>Take Profit:</b> <code>$${signal.takeProfitPrice.toFixed(2)}</code>`,
      `📊 <b>Ratio R:R Neto:</b> <b>1:${signal.netRR.toFixed(2)}</b> (Mínimo 1:4.0 verificado)`,
      ``,
      `🤖 <b>Auditoría IA (Doble Consenso):</b>`,
      `  • <b>OpenAI (${signal.consensusResult?.openaiReview?.model || 'gpt-4o'}):</b> ${signal.consensusResult?.openaiReview?.verdict || 'APPROVE'} (${signal.consensusResult?.openaiReview?.confidence || 0}%)`,
      `  • <b>Gemini (${signal.consensusResult?.geminiReview?.model || 'gemini-2.0-flash'}):</b> ${signal.consensusResult?.geminiReview?.verdict || 'APPROVE'} (${signal.consensusResult?.geminiReview?.confidence || 0}%)`,
      ``,
      `⚠️ <i>Modo SIGNALS_ONLY. Ejecución real con dinero desactivada. La confianza de IA es subjetiva. No operar es una decisión válida.</i>`,
    ].join('\n');

    await this.sendMessage(msg, 'SIGNAL_VALIDATED', signal.id);
  }

  public async notifyApproachingZone(signal: SignalInstance, currentPrice: number): Promise<void> {
    const distPcnt = (Math.abs(currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
    const msg = [
      `<b>📍 PRECIO APROXIMÁNDOSE A ZONA DE ENTRADA</b>`,
      ``,
      `Símbolo: <b>${signal.symbol}</b> (${signal.direction})`,
      `Precio Actual: <code>$${currentPrice.toFixed(2)}</code>`,
      `Zona de Entrada: <code>$${signal.entryPrice.toFixed(2)}</code> (distancia: ${distPcnt.toFixed(3)}%)`,
      `R:R Estimado: 1:${signal.netRR.toFixed(2)}`,
    ].join('\n');

    await this.sendMessage(msg, 'APPROACHING_ZONE', signal.id);
  }

  public async notifyInZone(signal: SignalInstance, currentPrice: number): Promise<void> {
    const msg = [
      `<b>🎯 PRECIO EN ZONA DE ENTRADA (IN_ZONE)</b>`,
      ``,
      `Símbolo: <b>${signal.symbol}</b> (${signal.direction})`,
      `Precio Actual: <code>$${currentPrice.toFixed(2)}</code>`,
      `Entrada esperada: <code>$${signal.entryPrice.toFixed(2)}</code>`,
      `Monitoreando gatillo de confirmación microestructural...`,
    ].join('\n');

    await this.sendMessage(msg, 'IN_ZONE', signal.id);
  }

  public async notifyEntryTriggered(signal: SignalInstance): Promise<void> {
    const dirEmoji = signal.direction === 'LONG' ? '🚀' : '🔻';
    const msg = [
      `<b>${dirEmoji} ENTRADA EJECUTADA (SIMULACIÓN PAPER TRADING)</b>`,
      ``,
      `Señal: <b>${signal.direction} ${signal.symbol}</b>`,
      `Precio de Llenado: <code>$${signal.entryPrice.toFixed(2)}</code>`,
      `Stop Loss: <code>$${signal.stopLossPrice.toFixed(2)}</code>`,
      `Take Profit: <code>$${signal.takeProfitPrice.toFixed(2)}</code>`,
      `Seguimiento activo de MFE / MAE iniciado.`,
    ].join('\n');

    await this.sendMessage(msg, 'ENTRY_TRIGGERED', signal.id);
  }

  public async notifyTakeProfitCompleted(signal: SignalInstance): Promise<void> {
    const msg = [
      `<b>🎉 TAKE PROFIT ALCANZADO (COMPLETED_TP)</b>`,
      ``,
      `Símbolo: <b>${signal.symbol}</b> (${signal.direction})`,
      `Precio Salida: <code>$${signal.exitPrice?.toFixed(2) || signal.takeProfitPrice.toFixed(2)}</code>`,
      `Beneficio Neto Realizado: <b>+${signal.realizedNetR?.toFixed(2) || signal.netRR.toFixed(2)}R</b> (+${signal.realizedNetPnlUsdt?.toFixed(2) || (signal.riskUsdt * signal.netRR).toFixed(2)} USDT)`,
      `MFE Máximo: +${signal.mfeR?.toFixed(2)}R`,
      `Duración Operación: ${Math.round((signal.durationMs || 0) / 60000)} minutos`,
    ].join('\n');

    await this.sendMessage(msg, 'COMPLETED_TP', signal.id);
  }

  public async notifyStopLossCompleted(signal: SignalInstance): Promise<void> {
    const msg = [
      `<b>🛑 STOP LOSS ALCANZADO (COMPLETED_SL)</b>`,
      ``,
      `Símbolo: <b>${signal.symbol}</b> (${signal.direction})`,
      `Precio Salida: <code>$${signal.exitPrice?.toFixed(2) || signal.stopLossPrice.toFixed(2)}</code>`,
      `Pérdida Neta: <b>-1.0R</b> (-${signal.riskUsdt} USDT)`,
      `MAE Máximo: ${signal.maeR?.toFixed(2)}R`,
      `Duración: ${Math.round((signal.durationMs || 0) / 60000)} minutos`,
    ].join('\n');

    await this.sendMessage(msg, 'COMPLETED_SL', signal.id);
  }

  public async notifyInvalidated(signal: SignalInstance, reason?: string): Promise<void> {
    const msg = [
      `<b>⚠️ SEÑAL INVALIDADA TÉCNICAMENTE</b>`,
      ``,
      `Símbolo: <b>${signal.symbol}</b> (${signal.direction})`,
      `Estrategia: ${signal.strategy}`,
      `Motivo: <i>${reason || signal.reason || 'Ruptura estructural o violación de reglas'}</i>`,
      `La oportunidad ha sido descartada de forma determinista.`,
    ].join('\n');

    await this.sendMessage(msg, 'INVALIDATED', signal.id);
  }

  public async notifyEmergencyKillSwitch(active: boolean, reason?: string): Promise<void> {
    const status = active ? '🔴 ACTIVADO' : '🟢 DESACTIVADO';
    const msg = [
      `<b>🚨 ALERTA DE SEGURIDAD — KILL SWITCH ${status}</b>`,
      ``,
      `Motivo: ${reason || 'Acción administrativa'}`,
      active
        ? `Toda generación de nuevas señales y monitoreo activo quedan suspendidos de inmediato.`
        : `El sistema ha reanudado el modo de observación estándar.`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join('\n');

    await this.sendMessage(msg, 'KILL_SWITCH', undefined);
  }

  public async sendTestNotification(): Promise<{ success: boolean; messageId?: number; error?: string }> {
    const msg = [
      `<b>🧪 NANOLABS AI TRADING — MENSAJE DE PRUEBA</b>`,
      ``,
      `Conexión con bot de Telegram verificada correctamente.`,
      `Hora local: ${new Date().toLocaleString('es-AR', { timeZone: config.timezone })}`,
      `Estado: Operativo 24/7`,
    ].join('\n');

    return this.sendMessage(msg, 'TEST');
  }
}
