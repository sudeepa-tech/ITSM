import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "./client";

export interface ApiState<T> { data: T | null; loading: boolean; error: string; reload: () => Promise<void>; set: (d: T | null) => void }

/** Minimal data hook: fetches on mount/dependency change, ignores stale responses, exposes reload(). */
export function useApi<T>(url: string | null, params?: object, deps: DependencyList = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const key = JSON.stringify(params ?? {});

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<T>(url, { params });
      if (my === seq.current) { setData(r.data); setError(""); }
    } catch (e) {
      if (my === seq.current) setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, ...deps]);

  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load, set: setData };
}
