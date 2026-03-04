"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

interface HealthResponse {
  status: string;
  info?: Record<string, { status: string }>;
  error?: Record<string, { status: string; message?: string }>;
}

export function HealthIndicator() {
  const { data, isError, isLoading } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/health`, { timeout: 5000 });
      return res.data;
    },
    refetchInterval: 30_000, // Poll every 30s
    retry: 1,
  });

  if (isLoading) {
    return (
      <Badge variant="outline" className="animate-pulse text-xs">
        Checking…
      </Badge>
    );
  }

  if (isError || !data) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="text-xs">
              API Offline
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Could not reach the backend API</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const isHealthy = data.status === "ok";
  const dbStatus = data.info?.database?.status;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isHealthy ? "outline" : "destructive"}
            className="text-xs"
          >
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                isHealthy ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {isHealthy ? "Healthy" : "Degraded"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Database: {dbStatus ?? "unknown"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
