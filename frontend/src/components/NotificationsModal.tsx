'use client';

import React, { useState, useEffect } from 'react';
import {
  Bell,
  Send,
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/api-config';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationsModal({ isOpen, onClose }: NotificationsModalProps) {
  const [telegramStatus, setTelegramStatus] = useState<string>('idle');
  const [telegramMsg, setTelegramMsg] = useState<string>('');
  const [pushStatus, setPushStatus] = useState<string>('idle');
  const [pushMsg, setPushMsg] = useState<string>('');
  const [isPushSupported, setIsPushSupported] = useState<boolean>(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [notificationsLog, setNotificationsLog] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsPushSupported(true);
      checkExistingSubscription();
    }
    if (isOpen) {
      fetchNotificationsLog();
    }
  }, [isOpen]);

  const checkExistingSubscription = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {}
  };

  const fetchNotificationsLog = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/notifications/history?limit=15`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setNotificationsLog(json.data);
      }
    } catch {}
  };

  const handleTestTelegram = async () => {
    setTelegramStatus('loading');
    setTelegramMsg('');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/notifications/telegram/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'nanolabs_admin_sec_2026',
        },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTelegramStatus('success');
        setTelegramMsg('¡Mensaje de prueba enviado exitosamente a Telegram!');
      } else {
        setTelegramStatus('error');
        setTelegramMsg(data.error || 'Error al enviar alerta a Telegram');
      }
    } catch (err: any) {
      setTelegramStatus('error');
      setTelegramMsg(err.message);
    }
    fetchNotificationsLog();
  };

  const handleToggleWebPush = async () => {
    setPushStatus('loading');
    setPushMsg('');

    try {
      if (isSubscribed) {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await fetch(`${getApiBaseUrl()}/api/v1/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        }
        setIsSubscribed(false);
        setPushStatus('success');
        setPushMsg('Notificaciones Web Push desactivadas');
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPushStatus('error');
          setPushMsg('Permiso de notificaciones denegado en el navegador');
          return;
        }

        const keyRes = await fetch(`${getApiBaseUrl()}/api/v1/push/vapid-public-key`);
        const { publicKey } = await keyRes.json();

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });

        const subJson = sub.toJSON();
        await fetch(`${getApiBaseUrl()}/api/v1/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subJson),
        });

        setIsSubscribed(true);
        setPushStatus('success');
        setPushMsg('¡Notificaciones Web Push PWA activadas exitosamente!');
      }
    } catch (err: any) {
      setPushStatus('error');
      setPushMsg(`Error Web Push: ${err.message}`);
    }
    fetchNotificationsLog();
  };

  const handleTestWebPush = async () => {
    setPushStatus('loading');
    setPushMsg('');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/push/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'nanolabs_admin_sec_2026',
        },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPushStatus('success');
        setPushMsg(`Alerta Web Push enviada (${data.result?.sent || 0} dispositivos notificados)`);
      } else {
        setPushStatus('error');
        setPushMsg('Error enviando notificación push de prueba');
      }
    } catch (err: any) {
      setPushStatus('error');
      setPushMsg(err.message);
    }
    fetchNotificationsLog();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0f1422] p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Bell className="w-5 h-5 text-amber-400" />
            <h3 className="font-display font-bold text-lg text-slate-100">
              Centro de Notificaciones 24/7 (Telegram & Web Push PWA)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-5 py-4 custom-scrollbar">
          {/* Telegram Card */}
          <div className="rounded-xl border border-slate-800/80 bg-[#141a29] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-sky-400" />
                <h4 className="font-bold text-sm text-slate-200">Bot Oficial de Telegram</h4>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Canal Dedicado
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Envía alertas instantáneas con formato Markdown, confluencia SMC/ICT, targets de entrada,
              SL, TP (mínimo 1:4.0 neto) y auditoría de IA de OpenAI y Gemini.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleTestTelegram}
                disabled={telegramStatus === 'loading'}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all disabled:opacity-50"
              >
                {telegramStatus === 'loading' ? 'Enviando...' : 'Enviar Alerta de Prueba'}
              </button>
            </div>
            {telegramMsg && (
              <p className={`mt-2 text-xs font-mono ${telegramStatus === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {telegramMsg}
              </p>
            )}
          </div>

          {/* Web Push Card */}
          <div className="rounded-xl border border-slate-800/80 bg-[#141a29] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <h4 className="font-bold text-sm text-slate-200">Notificaciones Web Push (PWA)</h4>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                  isSubscribed
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {isSubscribed ? 'Activo en este Navegador' : 'Inactivo'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Recibí notificaciones en tu celular o PC de escritorio incluso con la aplicación cerrada.
              Protocolo oficial VAPID con Service Worker nativo.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleToggleWebPush}
                disabled={!isPushSupported || pushStatus === 'loading'}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-50 ${
                  isSubscribed
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {pushStatus === 'loading'
                  ? 'Procesando...'
                  : isSubscribed
                  ? 'Desactivar Web Push'
                  : 'Activar Notificaciones Web Push'}
              </button>

              {isSubscribed && (
                <button
                  onClick={handleTestWebPush}
                  disabled={pushStatus === 'loading'}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
                >
                  Enviar Push de Prueba
                </button>
              )}
            </div>

            {pushMsg && (
              <p className={`mt-2 text-xs font-mono ${pushStatus === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {pushMsg}
              </p>
            )}
          </div>

          {/* Recent Notification Logs */}
          <div className="rounded-xl border border-slate-800/80 bg-[#141a29] p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-xs font-mono text-slate-300 uppercase">
                Historial de Alertas Emitidas
              </h4>
              <button
                onClick={fetchNotificationsLog}
                className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Actualizar
              </button>
            </div>

            <div className="overflow-x-auto custom-scrollbar max-h-40">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="pb-1.5">Hora</th>
                    <th className="pb-1.5">Canal</th>
                    <th className="pb-1.5">Tipo</th>
                    <th className="pb-1.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {notificationsLog.length > 0 ? (
                    notificationsLog.map((log) => (
                      <tr key={log.id}>
                        <td className="py-1.5 text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString('es-AR')}
                        </td>
                        <td className="py-1.5 font-bold text-slate-300">{log.channel}</td>
                        <td className="py-1.5 text-slate-400">{log.messageType}</td>
                        <td className="py-1.5">
                          <span
                            className={`px-1 rounded text-[10px] font-bold ${
                              log.status === 'DELIVERED'
                                ? 'text-emerald-400 bg-emerald-500/10'
                                : log.status === 'DEDUPLICATED'
                                ? 'text-blue-400 bg-blue-500/10'
                                : log.status === 'FAILED'
                                ? 'text-rose-400 bg-rose-500/10'
                                : 'text-slate-400 bg-slate-800'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500">
                        No hay registros recientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-mono font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
