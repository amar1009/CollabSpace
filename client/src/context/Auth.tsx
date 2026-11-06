import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { api, ApiError, errorMessage } from "../services/api";
import type { User } from "../types";
const Context = createContext<{
  user: User | null;
  loading: boolean;
  error: string;
  retry: () => void;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
} | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLoading(true);
    setError("");
    api<User>("/auth/me")
      .then(setUser)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) setUser(null);
        else setError(errorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [attempt]);
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error,
        retry: () => setAttempt((n) => n + 1),
        setUser,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  return useContext(Context)!;
}
