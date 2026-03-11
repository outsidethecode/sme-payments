"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import api from "@/lib/api";
import {
  Upload,
  FileJson,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  ShieldCheck,
  Loader2,
} from "lucide-react";

/* ── Types mirroring backend VerifyReport ─────────────────── */

type CheckStatus = "pass" | "fail" | "warn" | "info";

interface CheckResult {
  status: CheckStatus;
  message: string;
}

interface VerifySection {
  title: string;
  results: CheckResult[];
}

interface VerifyReport {
  version: string;
  generatedAt: string;
  envelopeId: string | null;
  sections: VerifySection[];
  totalPass: number;
  totalFail: number;
  totalWarn: number;
  verdict: "PASSED" | "PASSED_WITH_WARNINGS" | "FAILED";
}

/* ── Helpers ──────────────────────────────────────────────── */

const statusIcon: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />,
  fail: <XCircle className="h-4 w-4 text-red-600 shrink-0" />,
  warn: <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />,
  info: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
};

const verdictConfig = {
  PASSED: {
    label: "ALL CHECKS PASSED",
    color: "bg-green-100 text-green-800 border-green-300",
    icon: <ShieldCheck className="h-6 w-6" />,
  },
  PASSED_WITH_WARNINGS: {
    label: "PASSED WITH WARNINGS",
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
    icon: <AlertTriangle className="h-6 w-6" />,
  },
  FAILED: {
    label: "VERIFICATION FAILED",
    color: "bg-red-100 text-red-800 border-red-300",
    icon: <XCircle className="h-6 w-6" />,
  },
};

export default function VerifyPage() {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setReport(null);
    setFileName(file.name);

    if (!file.name.endsWith(".json")) {
      setError("Please upload a JSON file (.json)");
      return;
    }

    try {
      const text = await file.text();
      const pack = JSON.parse(text);
      setLoading(true);
      const { data } = await api.post<VerifyReport>("/verify", pack);
      setReport(data);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON — could not parse the file");
      } else {
        setError(err.response?.data?.message || "Verification request failed");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const reset = () => {
    setReport(null);
    setError(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-muted/30 p-4 pt-12">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Evidence Pack Verifier
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a Trust Envelope JSON to independently verify its integrity,
            hash chains, signatures, and tamper-evidence
          </p>
        </div>

        {/* Upload zone */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              Upload Evidence Pack
            </CardTitle>
            <CardDescription>
              Drag &amp; drop a <code>.json</code> evidence pack file, or click
              to browse
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileChange}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Verifying…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {fileName
                      ? `Loaded: ${fileName}`
                      : "Drop evidence-pack.json here or click to browse"}
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <XCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {report && (
          <>
            {/* Verdict banner */}
            <div
              className={`flex items-center justify-between rounded-lg border p-4 ${verdictConfig[report.verdict].color}`}
            >
              <div className="flex items-center gap-3">
                {verdictConfig[report.verdict].icon}
                <div>
                  <p className="font-bold text-lg">
                    {verdictConfig[report.verdict].label}
                  </p>
                  <p className="text-sm opacity-80">
                    {report.totalPass} passed · {report.totalFail} failed ·{" "}
                    {report.totalWarn} warnings
                  </p>
                </div>
              </div>
              <div className="text-right text-xs opacity-70">
                <p>Envelope v{report.version}</p>
                {report.envelopeId && (
                  <p className="font-mono">
                    {report.envelopeId.substring(0, 12)}…
                  </p>
                )}
              </div>
            </div>

            {/* Sections */}
            {report.sections.map((section, si) => {
              const hasFail = section.results.some((r) => r.status === "fail");
              const hasWarn =
                !hasFail && section.results.some((r) => r.status === "warn");

              return (
                <Card key={si}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>{section.title}</span>
                      {hasFail && <Badge variant="destructive">FAIL</Badge>}
                      {hasWarn && (
                        <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-300">
                          WARN
                        </Badge>
                      )}
                      {!hasFail && !hasWarn && (
                        <Badge className="bg-green-100 text-green-800 border border-green-300">
                          OK
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1.5">
                      {section.results.map((result, ri) => (
                        <div
                          key={ri}
                          className="flex items-start gap-2 text-sm"
                        >
                          {statusIcon[result.status]}
                          <span
                            className={
                              result.status === "fail"
                                ? "text-red-700 font-medium"
                                : result.status === "warn"
                                  ? "text-yellow-700"
                                  : result.status === "info"
                                    ? "text-muted-foreground"
                                    : ""
                            }
                          >
                            {result.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Footer */}
            <div className="flex justify-center pb-8">
              <Button variant="outline" onClick={reset}>
                Verify Another Pack
              </Button>
            </div>
          </>
        )}

        {/* Info footer when no results */}
        {!report && !loading && (
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  What does this verify?
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>SHA-256 hash chain integrity across all events</li>
                  <li>Payload hash & intent hash correctness</li>
                  <li>
                    WebAuthn ECDSA P-256 digital signatures (passkey-signed
                    approvals)
                  </li>
                  <li>Challenge binding to clientDataJSON</li>
                  <li>
                    Integrity root hashes (document, ledger, attachments,
                    envelope)
                  </li>
                  <li>Actor & approval cross-references</li>
                  <li>Platform signature (ECDSA P-256 envelope seal)</li>
                  <li>Timestamp ordering & credential uniqueness</li>
                </ul>
                <Separator className="my-3" />
                <p className="text-xs">
                  This verification runs entirely on the server using the same
                  cryptographic primitives as the platform. No login required —
                  this is a public service for banks, auditors, and
                  counterparties.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
