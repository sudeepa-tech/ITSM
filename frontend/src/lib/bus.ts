import { useEffect } from "react";

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();

/** Tiny pub/sub so socket events can refresh whichever page is on screen. */
export const bus = {
  on(event: string, h: Handler) { (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(h); return () => { handlers.get(event)?.delete(h); }; },
  emit(event: string, payload?: unknown) { handlers.get(event)?.forEach((h) => h(payload)); },
};
export function useBus(event: string, h: Handler) {
  useEffect(() => bus.on(event, h), [event, h]);
}
