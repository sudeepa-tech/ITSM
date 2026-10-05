import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => undefined);
export const useToast = () => useContext(Ctx);

const icon = { success: <CheckCircle2 size={16} className="text-ok" />, error: <CircleAlert size={16} className="text-bad" />, info: <Info size={16} className="text-brand" /> };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((text: string, kind: Kind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* role=status: screen readers announce toasts without stealing focus */}
      <div role="status" aria-live="polite" className="fixed z-[100] top-16 end-4 start-4 sm:start-auto flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 max-w-sm w-full sm:w-auto bg-surface border border-line shadow-pop rounded-lg ps-3 pe-2 py-2.5 animate-rise">
            <span className="mt-0.5">{icon[t.kind]}</span>
            <span className="text-[13.5px] flex-1">{t.text}</span>
            <button className="btn-icon !h-6 !w-6" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
