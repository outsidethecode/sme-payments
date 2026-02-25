"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { poApi, usersApi, type LineItem } from "@/lib/api";
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

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPricePennies: 0 },
  ]);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => usersApi.suppliers().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      supplierId: string;
      description?: string;
      lineItems: LineItem[];
    }) => poApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase order created");
      router.push(`/dashboard/purchase-orders/${res.data.id}`);
    },
    onError: () => {
      toast.error("Failed to create purchase order");
    },
  });

  function addLineItem() {
    setLineItems([
      ...lineItems,
      { description: "", quantity: 1, unitPricePennies: 0 },
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

    createMutation.mutate({
      supplierId,
      description: description || undefined,
      lineItems: validItems,
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
                      {s.companyName} ({s.name})
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
                <div className="grid gap-3 sm:grid-cols-[1fr_80px_120px_40px]">
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
                    <Label className="text-xs">Unit Price (£)</Label>
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
                  {formatCurrency(item.quantity * item.unitPricePennies)}
                </p>
              </div>
            ))}

            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-bold">
                {formatCurrency(totalPennies)}
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
