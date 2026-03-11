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

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
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
      toast.success("Purchase order created");
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
      toast.error(detail || "Failed to create purchase order");
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
      toast.error("Please select a supplier");
      return;
    }

    const validItems = lineItems.filter(
      (item) => item.description.trim() && item.unitPricePennies > 0,
    );
    if (validItems.length === 0) {
      toast.error("Add at least one line item with a price");
      return;
    }

    const itemTotal = validItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );
    if (itemTotal < minAmount) {
      toast.error(
        `Minimum order amount is ${formatCurrency(minAmount, currency)}`,
      );
      return;
    }
    if (itemTotal > maxAmount) {
      toast.error(
        `Maximum order amount is ${formatCurrency(maxAmount, currency)}`,
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
            New Purchase Order
          </h1>
          <p className="text-sm text-muted-foreground">
            Create a PO to send to a supplier
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Supplier Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a supplier" />
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
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="General notes about this order…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>External PO Number (optional)</Label>
              <Input
                placeholder="e.g. EXT-PO-2025-001"
                value={externalPoNumber}
                onChange={(e) => setExternalPoNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                    <SelectItem value="NET_15">Net 15</SelectItem>
                    <SelectItem value="NET_30">Net 30</SelectItem>
                    <SelectItem value="NET_45">Net 45</SelectItem>
                    <SelectItem value="NET_60">Net 60</SelectItem>
                    <SelectItem value="NET_90">Net 90</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delivery Terms</Label>
                <Select value={deliveryTerms} onValueChange={setDeliveryTerms}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EX_WORKS">Ex Works</SelectItem>
                    <SelectItem value="FOB">FOB</SelectItem>
                    <SelectItem value="CIF">CIF</SelectItem>
                    <SelectItem value="DDP">DDP</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Delivery Address (optional)</Label>
              <Input
                placeholder="Warehouse or delivery location"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={taxRate || ""}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  placeholder="e.g. 15 for 15% VAT"
                />
              </div>
              <div className="space-y-2">
                <Label>Dispute Window (hours)</Label>
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
              <Label>Expected Delivery Date (optional)</Label>
              <Input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Special Instructions / Notes (optional)</Label>
              <Textarea
                placeholder="Packaging requirements, handling instructions, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Separator />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Buyer Contact
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact Name (optional)</Label>
                <Input
                  placeholder="e.g. John Smith"
                  value={buyerContactName}
                  onChange={(e) => setBuyerContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Email (optional)</Label>
                <Input
                  type="email"
                  placeholder="e.g. john@company.com"
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
              <CardTitle className="text-base">Line Items</CardTitle>
              <CardDescription>
                Add the goods or services being ordered
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLineItem}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Item
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index}>
                {index > 0 && <Separator className="mb-4" />}
                <div className="grid gap-3 sm:grid-cols-[100px_1fr_80px_100px_120px_40px]">
                  <div className="space-y-1">
                    <Label className="text-xs">SKU</Label>
                    <Input
                      placeholder="SKU / Part #"
                      value={item.sku || ""}
                      onChange={(e) =>
                        updateLineItem(index, "sku", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input
                      placeholder="Item description"
                      value={item.description}
                      onChange={(e) =>
                        updateLineItem(index, "description", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Qty</Label>
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
                    <Label className="text-xs">UOM</Label>
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
                        <SelectItem value="EACH">Each</SelectItem>
                        <SelectItem value="KG">Kg</SelectItem>
                        <SelectItem value="LITRE">Litre</SelectItem>
                        <SelectItem value="METRE">Metre</SelectItem>
                        <SelectItem value="BOX">Box</SelectItem>
                        <SelectItem value="PALLET">Pallet</SelectItem>
                        <SelectItem value="HOUR">Hour</SelectItem>
                        <SelectItem value="DAY">Day</SelectItem>
                        <SelectItem value="SET">Set</SelectItem>
                        <SelectItem value="LOT">Lot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Unit Price ({currencySymbol.trim()})
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
                  Subtotal:{" "}
                  {formatCurrency(
                    item.quantity * item.unitPricePennies,
                    currency,
                  )}
                </p>
              </div>
            ))}

            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total</span>
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
            {createMutation.isPending ? "Creating…" : "Create Purchase Order"}
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
