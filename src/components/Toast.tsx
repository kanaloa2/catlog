import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface ToastAction {
  label: string;
  run?: () => void | Promise<void>;
  to?: string;
}
interface ToastState {
  id: number;
  text: string;
  actions: ToastAction[];
}

const Ctx = createContext<(text: string, actions?: ToastAction[]) => void>(() => {});

/** Shows a short message at the bottom of the screen, with optional actions like Undo. */
export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const show = useCallback((text: string, actions: ToastAction[] = []) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, text, actions });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), actions.length ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span className="toast-text">{toast.text}</span>
          {toast.actions.map((a) => (
            <button
              key={a.label}
              className="toast-btn"
              onClick={async () => {
                setToast(null);
                if (a.run) await a.run();
                if (a.to) navigate(a.to);
              }}
            >
              {a.label}
            </button>
          ))}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
