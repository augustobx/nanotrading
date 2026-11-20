'use client';

import React from 'react';

interface OrderBookLevel {
  0: number; // price
  1: number; // size
}

interface OrderBookData {
  bids: [number, number][];
  asks: [number, number][];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPcnt: number;
  imbalance: number;
}

interface OrderBookWidgetProps {
  orderBook: OrderBookData | null;
}

export function OrderBookWidget({ orderBook }: OrderBookWidgetProps) {
  if (!orderBook || (!orderBook.bids?.length && !orderBook.asks?.length)) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 text-center">
        <p className="text-xs text-slate-500 font-mono">Esperando Order Book Bybit V5 L2...</p>
      </div>
    );
  }

  const bids = (orderBook.bids || []).slice(0, 8);
  const asks = (orderBook.asks || []).slice(0, 8);

  const maxBidVol = Math.max(...bids.map((b) => b[1]), 1);
  const maxAskVol = Math.max(...asks.map((a) => a[1]), 1);

  // Imbalance indicator percentage
  const bidRatio = Math.round(((orderBook.imbalance + 1) / 2) * 100);

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-live" />
          <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">
            Order Book L2
          </h3>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-slate-500">Spread:</span>
          <span className="text-amber-400 font-bold">${orderBook.spread.toFixed(2)}</span>
          <span className="text-slate-500 text-[10px]">({orderBook.spreadPcnt.toFixed(4)}%)</span>
        </div>
      </div>

      {/* Imbalance Meter */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] font-mono mb-1">
          <span className="text-emerald-400 font-bold">Bids {bidRatio}%</span>
          <span className="text-slate-400">Imbalance</span>
          <span className="text-rose-400 font-bold">Asks {100 - bidRatio}%</span>
        </div>
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div
            className="bg-emerald-500 transition-all duration-300"
            style={{ width: `${bidRatio}%` }}
          />
          <div
            className="bg-rose-500 transition-all duration-300"
            style={{ width: `${100 - bidRatio}%` }}
          />
        </div>
      </div>

      {/* Asks (Sells) Table */}
      <div className="space-y-1 mb-2">
        {asks.slice().reverse().map(([price, size], i) => {
          const depthPercent = Math.min((size / maxAskVol) * 100, 100);
          return (
            <div key={`ask-${i}`} className="relative flex justify-between text-xs font-mono py-0.5 px-2 rounded">
              <div
                className="absolute right-0 top-0 bottom-0 bg-rose-500/10 rounded"
                style={{ width: `${depthPercent}%` }}
              />
              <span className="relative z-10 text-rose-400 font-semibold">{price.toFixed(1)}</span>
              <span className="relative z-10 text-slate-400">{size.toFixed(3)}</span>
            </div>
          );
        })}
      </div>

      {/* Mid Price Divider */}
      <div className="py-1 px-2 my-1 bg-slate-900/90 rounded-lg flex items-center justify-between border border-slate-800 font-mono text-xs">
        <span className="text-slate-500 text-[11px]">Best:</span>
        <span className="text-slate-100 font-extrabold text-sm">${orderBook.bestBid.toFixed(1)}</span>
        <span className="text-slate-500 text-[10px]">L2 Depth 50</span>
      </div>

      {/* Bids (Buys) Table */}
      <div className="space-y-1 mt-2">
        {bids.map(([price, size], i) => {
          const depthPercent = Math.min((size / maxBidVol) * 100, 100);
          return (
            <div key={`bid-${i}`} className="relative flex justify-between text-xs font-mono py-0.5 px-2 rounded">
              <div
                className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 rounded"
                style={{ width: `${depthPercent}%` }}
              />
              <span className="relative z-10 text-emerald-400 font-semibold">{price.toFixed(1)}</span>
              <span className="relative z-10 text-slate-400">{size.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
