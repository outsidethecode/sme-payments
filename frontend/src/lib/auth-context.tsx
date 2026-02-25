"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, type User } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // On mount, try to restore session from stored token
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => setUser(res.data))
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  // Sync auth state across browser tabs
  useEffect(() => {
    function onStorageChange(e: StorageEvent) {
      if (e.key !== "token") return;
      if (!e.newValue) {
        // Token was removed in another tab → log out here too
        setUser(null);
        queryClient.clear();
        window.location.href = "/login";
      } else if (e.newValue !== e.oldValue) {
        // Token changed in another tab → re-validate identity
        authApi
          .me()
          .then((res) => {
            setUser(res.data);
            queryClient.clear(); // flush stale data from previous user
          })
          .catch(() => {
            localStorage.removeItem("token");
            setUser(null);
            queryClient.clear();
            window.location.href = "/login";
          });
      }
    }
    window.addEventListener("storage", onStorageChange);
    return () => window.removeEventListener("storage", onStorageChange);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await authApi.login(email, password);
      localStorage.setItem("token", data.accessToken);
      setUser(data.user);
      queryClient.clear(); // flush stale data from previous user
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUser(null);
    queryClient.clear();
    window.location.href = "/login";
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
