"use client";
import { useEffect, useRef, useState } from "react";

type StreamEvent = {
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
};

const MAX_KEEP = 100;

/**
 * Live, server-sent feed of GatewayWorker events. Connects to
 * `/api/gateway/stream` (SSE), replays the last 50 events on connect, then
 * tails new events. Auto-reconnects with exponential backoff.
 *
 * Honesty knob: the connection state is shown verbatim — green = open,
 * amber = reconnecting, red = unavailable. There is no fake "live" badge.
 */
export function LiveSettlementPanel({ endpoint = "/api/gateway/stream" }: { endpoint?: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [state, setState] = useState<"connecting" | "open" | "reconnecting" | "error">("connecting");
  const [lastError, setLastError] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      try {
        setState(reconnectAttempt.current === 0 ? "connecting" : "reconnecting");
        const es = new EventSource(endpoint);
        esRef.current = es;
        es.onopen = () => {
          if (cancelled) return;
          reconnectAttempt.current = 0;
          setState("open");
          setLastError("");
        };
        es.onmessage = (ev) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(ev.data) as StreamEvent;
            setEvents((prev) => [data, ...prev].slice(0, MAX_KEEP));
          } catch {
            /* ignore malformed payload */
          }
        };
        es.onerror = () => {
          if (cancelled) return;
          es.close();
          esRef.current = null;
          setState("reconnecting");
          setLastError("connection dropped");
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, reconnectAttempt.current));
          reconnectAttempt.current += 1;
          reconnectTimer.current = setTimeout(connect, delay);
        };
      } catch (err) {
        setState("error");
        setLastError((err as Error).message);
      }
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [endpoint]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-semibold">Live gateway feed</h2>
          <p className="text-xs text-ink/60">
            Server-sent stream of every action, payment, batch, and on-chain settlement as the
            GatewayWorker emits it. The panel shows real DB events — no replays, no fake fan-out.
          </p>
        </div>
        <span
          className={
            "text-xs font-mono px-2 py-1 rounded " +
            (state === "open"
              ? "bg-emerald/10 text-emerald"
              : state === "connecting" || state === "reconnecting"
                ? "bg-amber/10 text-amber"
                : "bg-coral/10 text-coral")
          }
          title={lastError || ""}
        >
          {state}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="text-ink/50 text-sm">
          Waiting for events… run <span className="kbd">npm run demo</span> to generate paid actions.
        </p>
      ) : (
        <ul className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs">
          {events.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="border-b border-ink/5 py-1 flex items-start gap-3">
              <span className="text-ink/40 shrink-0 w-20">
                {new Date(e.ts).toISOString().slice(11, 19)}
              </span>
              <span
                className={
                  "shrink-0 w-32 " +
                  (e.type.includes("settle")
                    ? "text-emerald"
                    : e.type.includes("error") || e.type.includes("fail")
                      ? "text-coral"
                      : "text-indigo")
                }
              >
                {e.type}
              </span>
              <span className="text-ink/70 truncate">
                {e.payload ? JSON.stringify(e.payload) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
