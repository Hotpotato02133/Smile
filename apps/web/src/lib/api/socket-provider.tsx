"use client";

import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./client";

interface RealtimeContextValue {
  isConnected: boolean;
  subscribePublicClinic: (slug: string) => void;
  subscribeClinic: (overrideClinicId?: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  isConnected: false,
  subscribePublicClinic: () => undefined,
  subscribeClinic: () => undefined,
});

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const invalidatePrefixes = useCallback(
    (prefixes: string[]) => {
      for (const prefix of prefixes) {
        void queryClient.invalidateQueries({
          predicate: (q) =>
            typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(prefix),
        });
      }
    },
    [queryClient]
  );

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    const connect = async () => {
      const token = isSignedIn ? await getToken().catch(() => null) : null;
      if (!active) return;

      const socket = io(API_BASE_URL, {
        transports: ["websocket", "polling"],
        auth: token ? { token } : {},
        autoConnect: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 15000,
        reconnectionAttempts: 10,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setIsConnected(true);
        if (token) {
          socket.emit("join:clinic", {});
        }
        // Auto-hydrate any queries that failed or went stale while API was booting/restarting
        void queryClient.refetchQueries({
          type: "active",
          predicate: (q) => q.state.status === "error" || q.isStale(),
        });
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
      });

      socket.on("appointment.changed", () => {
        invalidatePrefixes([
          "appointments",
          "availability",
          "patientPortal",
          "clinicAdmin",
        ]);
      });

      socket.on("slot_lock.changed", () => {
        invalidatePrefixes(["availability", "appointments"]);
      });

      socket.on("slots.changed", () => {
        invalidatePrefixes(["availability"]);
      });

      socket.on("waitlist.updated", () => {
        invalidatePrefixes(["appointments", "waitlist", "patientPortal"]);
      });

      socket.on("odontogram.updated", () => {
        invalidatePrefixes(["odontogram", "patientPortal"]);
      });

      socket.on("clinic.status_changed", () => {
        invalidatePrefixes(["clinicAdmin", "superAdmin", "publicBooking"]);
      });
    };

    void connect();

    return () => {
      active = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isLoaded, isSignedIn, getToken, invalidatePrefixes, queryClient]);

  const subscribePublicClinic = useCallback((slug: string) => {
    if (!slug) return;
    socketRef.current?.emit("join:public-clinic", { slug });
  }, []);

  const subscribeClinic = useCallback((overrideClinicId?: string) => {
    socketRef.current?.emit("join:clinic", { overrideClinicId });
  }, []);

  return (
    <RealtimeContext.Provider
      value={{ isConnected, subscribePublicClinic, subscribeClinic }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}
