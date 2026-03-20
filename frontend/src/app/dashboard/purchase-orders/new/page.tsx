"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { poApi, usersApi, policiesApi, type LineItem } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/i18n";

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useTranslation();
  const currency: "GBP" | "SAR" = user?.currency === "SAR" ? "SAR" : "GBP";
  const currencySymbol = currency === "SAR" ? "SAR " : "£";

  const { data: poLimits } = useQuery({
    queryKey: ["po-limits"],
    queryFn: () => policiesApi.poLimits().then((r) => r.data),
  });
  const minAmount =
    poLimits?.minAmount ?? (currency === "SAR" ? 1_875_00 : 500_00);
  const maxAmount =
    poLimits?.maxAmount ?? (currency === "SAR" ? 93_750_000 : 250_000_00);

  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [externalPoNumber, setExternalPoNumber] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("IMMEDIATE");
  const [deliveryTerms, setDeliveryTerms] = useState("EX_WORKS");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [taxRate, setTaxRate] = useState(0); // percentage, converted to BPS
  const [disputeWindowHours, setDisputeWindowHours] = useState(72);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [buyerContactName, setBuyerContactName] = useState("");
  const [buyerContactEmail, setBuyerContactEmail] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      description: "",
      quantity: 1,
      unitPricePennies: 0,
      sku: "",
      unitOfMeasure: "EACH",
    },
  ]);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => usersApi.suppliers().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof poApi.create>[0]) =>
      poApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(t("newPO.poCreated"));
      router.push(`/dashboard/purchase-orders/${res.data.id}`);
    },
    onError: (
      err: Error & {
        response?: { data?: { message?: string | string[] }; status?: number };
      },
    ) => {
      console.error(
        "PO create failed:",
        err.response?.status,
        JSON.stringify(err.response?.data),
      );
      const msg = err.response?.data?.message;
      const detail = Array.isArray(msg) ? msg.join(", ") : msg;
      toast.error(detail || t("newPO.poCreateFailed"));
    },
  });

  function addLineItem() {
    setLineItems([
      ...lineItems,
      {
        description: "",
        quantity: 1,
        unitPricePennies: 0,
        sku: "",
        unitOfMeasure: "EACH",
      },
    ]);
  }

  function removeLineItem(index: number) {
    setLineItems(lineItems.filter((_, i) => i !== index));
  }

  function updateLineItem(
    index: number,
    field: keyof LineItem,
    value: string | number,
  ) {
    const updated = [...lineItems];
    if (field === "description") {
      updated[index].description = value as string;
    } else if (field === "quantity") {
      updated[index].quantity = Math.max(1, Number(value));
    } else if (field === "unitPricePennies") {
      // Input is in pounds, convert to pennies
      updated[index].unitPricePennies = Math.round(Number(value) * 100);
    } else if (field === "sku") {
      updated[index].sku = value as string;
    } else if (field === "unitOfMeasure") {
      updated[index].unitOfMeasure = value as string;
    }
    setLineItems(updated);
  }

  const totalPennies = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPricePennies,
    0,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!supplierId) {
      toast.error(t("newPO.selectSupplierError"));
      return;
    }

    const validItems = lineItems.filter(
      (item) => item.description.trim() && item.unitPricePennies > 0,
    );
    if (validItems.length === 0) {
      toast.error(t("newPO.addLineItemError"));
      return;
    }

    const itemTotal = validItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );
    if (itemTotal < minAmount) {
      toast.error(
        t("newPO.minAmountError", {
          amount: formatCurrency(minAmount, currency),
        }),
      );
      return;
    }
    if (itemTotal > maxAmount) {
      toast.error(
        t("newPO.maxAmountError", {
          amount: formatCurrency(maxAmount, currency),
        }),
      );
      return;
    }

    createMutation.mutate({
      supplierId,
      description: description || undefined,
      lineItems: validItems,
      externalPoNumber: externalPoNumber || undefined,
      paymentTerms,
      deliveryTerms,
      deliveryAddress: deliveryAddress || undefined,
      taxRate: Math.round(taxRate * 100), // percentage to BPS
      disputeWindowHours,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      notes: notes || undefined,
      buyerContactName: buyerContactName || undefined,
      buyerContactEmail: buyerContactEmail || undefined,
    });
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
            {t("newPO.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("newPO.subtitle")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Supplier Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("newPO.orderDetails")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("newPO.supplier")}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("newPO.selectSupplier")} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {(s as any).organisationName || s.companyName} ({s.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("newPO.description")}</Label>
              <Textarea
                placeholder={t("newPO.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("newPO.externalPONumber")}</Label>
              <Input
                placeholder={t("newPO.externalPOPlaceholder")}
                value={externalPoNumber}
                onChange={(e) => setExternalPoNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("newPO.paymentTerms")}</Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE">
                      {t("newPO.immediate")}
                    </SelectItem>
                    <SelectItem value="NET_15">{t("newPO.net15")}</SelectItem>
                    <SelectItem value="NET_30">{t("newPO.net30")}</SelectItem>
                    <SelectItem value="NET_45">{t("newPO.net45")}</SelectItem>
                    <SelectItem value="NET_60">{t("newPO.net60")}</SelectItem>
                    <SelectItem value="NET_90">{t("newPO.net90")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("newPO.deliveryTerms")}</Label>
                <Select value={deliveryTerms} onValueChange={setDeliveryTerms}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EX_WORKS">
                      {t("newPO.exWorks")}
                    </SelectItem>
                    <SelectItem value="FOB">{t("newPO.fob")}</SelectItem>
                    <SelectItem value="CIF">{t("newPO.cif")}</SelectItem>
                    <SelectItem value="DDP">{t("newPO.ddp")}</SelectItem>
                    <SelectItem value="CUSTOM">{t("newPO.custom")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("newPO.deliveryAddress")}</Label>
              <Input
                placeholder={t("newPO.deliveryAddressPlaceholder")}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("newPO.taxRate")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={taxRate || ""}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  placeholder={t("newPO.taxRatePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("newPO.disputeWindow")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={disputeWindowHours}
                  onChange={(e) =>
                    setDisputeWindowHours(Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("newPO.expectedDeliveryDate")}</Label>
              <Input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("newPO.specialInstructions")}</Label>
              <Textarea
                placeholder={t("newPO.notesPlaceholder")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Separator />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("newPO.buyerContact")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("newPO.contactName")}</Label>
                <Input
                  placeholder={t("newPO.contactNamePlaceholder")}
                  value={buyerContactName}
                  onChange={(e) => setBuyerContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("newPO.contactEmail")}</Label>
                <Input
                  type="email"
                  placeholder={t("newPO.contactEmailPlaceholder")}
                  value={buyerContactEmail}
                  onChange={(e) => setBuyerContactEmail(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {t("newPO.lineItems")}
              </CardTitle>
              <CardDescription>
                {t("newPO.lineItemsDescription")}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLineItem}
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("newPO.addItem")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index}>
                {index > 0 && <Separator className="mb-4" />}
                <div className="grid gap-3 sm:grid-cols-[100px_1fr_80px_100px_120px_40px]">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("newPO.sku")}</Label>
                    <Input
                      placeholder={t("newPO.skuPlaceholder")}
                      value={item.sku || ""}
                      onChange={(e) =>
                        updateLineItem(index, "sku", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {t("newPO.lineDescription")}
                    </Label>
                    <Input
                      placeholder={t("newPO.itemDescriptionPlaceholder")}
                      value={item.description}
                      onChange={(e) =>
                        updateLineItem(index, "description", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("newPO.qty")}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateLineItem(index, "quantity", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("newPO.uom")}</Label>
                    <Select
                      value={item.unitOfMeasure || "EACH"}
                      onValueChange={(v) =>
                        updateLineItem(index, "unitOfMeasure", v)
                      }
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EACH">{t("newPO.each")}</SelectItem>
                        <SelectItem value="KG">{t("newPO.kg")}</SelectItem>
                        <SelectItem value="LITRE">
                          {t("newPO.litre")}
                        </SelectItem>
                        <SelectItem value="METRE">
                          {t("newPO.metre")}
                        </SelectItem>
                        <SelectItem value="BOX">{t("newPO.box")}</SelectItem>
                        <SelectItem value="PALLET">
                          {t("newPO.pallet")}
                        </SelectItem>
                        <SelectItem value="HOUR">{t("newPO.hour")}</SelectItem>
                        <SelectItem value="DAY">{t("newPO.day")}</SelectItem>
                        <SelectItem value="SET">{t("newPO.set")}</SelectItem>
                        <SelectItem value="LOT">{t("newPO.lot")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {t("newPO.unitPrice")} ({currencySymbol.trim()})
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unitPricePennies / 100 || ""}
                      onChange={(e) =>
                        updateLineItem(
                          index,
                          "unitPricePennies",
                          e.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLineItem(index)}
                      disabled={lineItems.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {t("newPO.subtotal")}{" "}
                  {formatCurrency(
                    item.quantity * item.unitPricePennies,
                    currency,
                  )}
                </p>
              </div>
            ))}

            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("newPO.total")}</span>
              <span className="text-lg font-bold">
                {formatCurrency(totalPennies, currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="submit"
            className="flex-1"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? t("newPO.creating")
              : t("newPO.createPurchaseOrder")}
          </Button>
          <Link href="/dashboard/purchase-orders">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
