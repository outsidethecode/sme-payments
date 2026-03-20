"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { poApi } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  ArrowLeft,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/i18n";

export default function ImportPOPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => poApi.importCSV(file),
    onSuccess: (res) => {
      setResult(res.data);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      if (res.data.imported > 0 && res.data.errors.length === 0) {
        toast.success(
          t("importPO.importSuccess", { count: res.data.imported }),
        );
      } else if (res.data.imported > 0) {
        toast.success(
          t("importPO.importPartial", {
            imported: res.data.imported,
            errors: res.data.errors.length,
          }),
        );
      } else {
        toast.error(t("importPO.importCheckErrors"));
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || t("importPO.importFailed"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error(t("importPO.selectCSVFirst"));
      return;
    }
    setResult(null);
    importMutation.mutate(selectedFile);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/purchase-orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("importPO.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("importPO.subtitle")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" />
            {t("importPO.csvFormat")}
          </CardTitle>
          <CardDescription>
            Your CSV file should have these columns. Rows with the same
            externalPoNumber are merged into one PO with multiple line items.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1 font-semibold">
                    {t("importPO.colColumn")}
                  </th>
                  <th className="text-left p-1 font-semibold">
                    {t("importPO.colRequired")}
                  </th>
                  <th className="text-left p-1 font-semibold">
                    {t("importPO.colDescription")}
                  </th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr>
                  <td className="p-1 font-mono">supplierId</td>
                  <td className="p-1">✓</td>
                  <td className="p-1">{t("importPO.colSupplierId")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">lineDescription</td>
                  <td className="p-1">✓</td>
                  <td className="p-1">{t("importPO.colItemDescription")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">quantity</td>
                  <td className="p-1">✓</td>
                  <td className="p-1">{t("importPO.colQuantity")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">unitPricePennies</td>
                  <td className="p-1">✓</td>
                  <td className="p-1">{t("importPO.colPrice")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">description</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colPODescription")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">externalPoNumber</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colExternalRef")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">paymentTerms</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colPaymentTerms")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">deliveryTerms</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colDeliveryTerms")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">deliveryAddress</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colDeliveryAddress")}</td>
                </tr>
                <tr>
                  <td className="p-1 font-mono">taxRate</td>
                  <td className="p-1"></td>
                  <td className="p-1">{t("importPO.colTaxRate")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("importPO.uploadCSV")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("importPO.csvFile")}</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] || null);
                  setResult(null);
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={!selectedFile || importMutation.isPending}
            >
              <Upload className="mr-2 h-4 w-4" />
              {importMutation.isPending
                ? t("importPO.importing")
                : t("importPO.importPOs")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("importPO.importResults")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm">
                <strong>{result.imported}</strong>{" "}
                {t("importPO.posImported", { count: result.imported }).replace(
                  `${result.imported} `,
                  "",
                )}
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {t("importPO.errorsCount", { count: result.errors.length })}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-xs space-y-1">
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-destructive">
                      {err}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {result.imported > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard/purchase-orders")}
              >
                {t("importPO.viewPurchaseOrders")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
