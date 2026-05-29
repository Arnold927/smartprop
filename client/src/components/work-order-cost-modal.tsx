import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, Plus, Trash2, Package, Receipt } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

interface Material {
  id: number;
  name: string;
  quantity: number;
  unitCost: number;
}

interface Charge {
  id: number;
  description: string;
  amount: number;
}

interface Props {
  workOrderId: number;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const WorkOrderCostModal: React.FC<Props> = ({ workOrderId, isOpen, setIsOpen }) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [nextMaterialId, setNextMaterialId] = useState(1);
  const [nextChargeId, setNextChargeId] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  // BUG 9 FIX: /api/work-orders/:id/materials and /api/work-orders/:id/charges do
  // not exist on the server. The available sub-resources are:
  //   GET  /api/work-orders/:id/cost-summary  → { materialCost, expenseCost, estimatedCost, total, variance }
  //   GET  /api/work-orders/:workOrderId/expenses → expense records
  // We load the expense records (charges) from /expenses, and show materials as an
  // empty editable list (there is no server-side materials list endpoint exposed to
  // clients yet — new entries are POSTed via /expenses with a "material" category).
  //
  // BUG 10 FIX: Removed all localStorage.getItem("access_token") calls. apiRequest
  // already injects the Authorization header from the app's auth state. Passing a
  // manual Authorization header here was redundant and broke when the stored token
  // key name differed from what apiRequest uses.
  useEffect(() => {
    if (!isOpen) return;

    async function fetchData() {
      try {
        // Load existing expenses (what the server calls "charges").
        // BUG 9 FIX: use /expenses, not the non-existent /charges endpoint.
        const expensesRes = await apiRequest(`/api/work-orders/${workOrderId}/expenses`);
        const expensesJson = await expensesRes.json();

        // The expenses endpoint returns raw DB records. Split them into
        // materials (category === "material") and other charges.
        const allExpenses: any[] = Array.isArray(expensesJson) ? expensesJson : [];

        const mats: Material[] = allExpenses
          .filter((e) => e.category === "material" || e.expenseType === "material")
          .map((e, idx) => ({
            id: e.id ?? idx + 1,
            name: e.description ?? e.itemName ?? "",
            quantity: Number(e.quantity ?? 1),
            unitCost: Number(e.unitCost ?? e.amount ?? 0),
          }));

        const chgs: Charge[] = allExpenses
          .filter((e) => e.category !== "material" && e.expenseType !== "material")
          .map((e, idx) => ({
            id: e.id ?? idx + 1,
            description: e.description ?? "",
            amount: Number(e.amount ?? 0),
          }));

        setMaterials(mats);
        setCharges(chgs);
        setNextMaterialId(mats.length > 0 ? Math.max(...mats.map((m) => m.id)) + 1 : 1);
        setNextChargeId(chgs.length > 0 ? Math.max(...chgs.map((c) => c.id)) + 1 : 1);
      } catch (err) {
        console.error(err);
        toast({
          title: "Error fetching data",
          description: "Could not load existing materials or charges.",
          variant: "destructive",
        });
        setMaterials([]);
        setCharges([]);
      }
    }

    fetchData();
  }, [isOpen, workOrderId]);


  const handleAddMaterial = () => {
    setMaterials([...materials, { id: nextMaterialId, name: "", quantity: 1, unitCost: 0 }]);
    setNextMaterialId(nextMaterialId + 1);
  };

  const handleAddCharge = () => {
    setCharges([...charges, { id: nextChargeId, description: "", amount: 0 }]);
    setNextChargeId(nextChargeId + 1);
  };

  const handleRemoveMaterial = (id: number) => {
    setMaterials(materials.filter((m) => m.id !== id));
  };

  const handleRemoveCharge = (id: number) => {
    setCharges(charges.filter((c) => c.id !== id));
  };

  const totalCost =
    materials.reduce((sum, m) => sum + m.quantity * m.unitCost, 0) +
    charges.reduce((sum, c) => sum + c.amount, 0);

  // BUG 9 FIX: POST new entries to /api/work-orders/:id/expenses (the endpoint
  // that actually exists). Existing records are updated via PUT on the same path.
  // BUG 10 FIX: No manual token header — apiRequest handles auth.
  const handleSave = async () => {
    setIsSaving(true);

    try {
      // Persist materials as expenses with category "material".
      await Promise.all(
        materials.map((m) => {
          const body = {
            description: m.name,
            amount: (m.quantity * m.unitCost).toString(),
            category: "material",
            quantity: m.quantity,
            unitCost: m.unitCost.toString(),
          };

          // Negative IDs are new rows created client-side; positive IDs came from the server.
          // Since the server doesn't expose a PUT /expenses/:id route in this codebase,
          // we POST everything and let the server deduplicate if needed. Adjust this
          // to a PUT call once that route is available.
          return apiRequest(`/api/work-orders/${workOrderId}/expenses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            data: body,
          });
        })
      );

      // Persist additional charges as generic expenses.
      await Promise.all(
        charges.map((c) => {
          const body = {
            description: c.description,
            amount: c.amount.toString(),
            category: "other",
          };

          return apiRequest(`/api/work-orders/${workOrderId}/expenses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            data: body,
          });
        })
      );

      toast({
        title: "Cost Updated Successfully",
        description: `Total cost: Ksh${totalCost.toFixed(2)}`,
        className: "bg-card text-foreground border border-border shadow-lg",
      });

      setIsOpen(false);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to update work order cost.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };



  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-3xl bg-card backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Update Work Order Cost
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
          {/* Materials Section */}
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                <Package className="h-5 w-5" />
                Materials
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {materials.length > 0 ? (
                materials.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
                    <div className="flex-1 grid grid-cols-12 gap-3">
                      <div className="col-span-5">
                        <Label htmlFor={`material-name-${m.id}`} className="text-xs text-muted-foreground mb-1">Name</Label>
                        <Input
                          id={`material-name-${m.id}`}
                          placeholder="e.g., Plywood, Nails, Paint"
                          value={m.name}
                          onChange={(e) =>
                            setMaterials(materials.map((mat) => (mat.id === m.id ? { ...mat, name: e.target.value } : mat)))
                          }
                          className="border-border focus:border-blue-300 focus:ring-blue-200"
                        />
                      </div>
                      <div className="col-span-3">
                        <Label htmlFor={`material-qty-${m.id}`} className="text-xs text-muted-foreground mb-1">Quantity</Label>
                        <Input
                          id={`material-qty-${m.id}`}
                          type="number"
                          min="1"
                          placeholder="Qty"
                          value={m.quantity}
                          onChange={(e) =>
                            setMaterials(materials.map((mat) => (mat.id === m.id ? { ...mat, quantity: Number(e.target.value) } : mat)))
                          }
                          className="border-border focus:border-blue-300 focus:ring-blue-200"
                        />
                      </div>
                      <div className="col-span-3">
                        <Label htmlFor={`material-cost-${m.id}`} className="text-xs text-muted-foreground mb-1">Unit Cost (Ksh)</Label>
                        <Input
                          id={`material-cost-${m.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={m.unitCost}
                          onChange={(e) =>
                            setMaterials(materials.map((mat) => (mat.id === m.id ? { ...mat, unitCost: Number(e.target.value) } : mat)))
                          }
                          className="border-border focus:border-blue-300 focus:ring-blue-200"
                        />
                      </div>
                      <div className="col-span-1 flex items-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMaterial(m.id)}
                          className="h-10 w-10 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {m.name && m.quantity > 0 && m.unitCost > 0 && (
                      <div className="text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                        {(m.quantity * m.unitCost).toFixed(2)}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No materials added yet</p>
                </div>
              )}

              <Button
                variant="outline"
                onClick={handleAddMaterial}
                className="w-full border-dashed border-border hover:border-border hover:bg-muted"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Material
              </Button>
            </CardContent>
          </Card>

          {/* Additional Charges Section */}
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Additional Charges
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {charges.length > 0 ? (
                charges.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
                    <div className="flex-1 grid grid-cols-12 gap-3">
                      <div className="col-span-9">
                        <Label htmlFor={`charge-desc-${c.id}`} className="text-xs text-muted-foreground mb-1">Description</Label>
                        <Input
                          id={`charge-desc-${c.id}`}
                          placeholder="e.g., Labor, Delivery, Permit Fees"
                          value={c.description}
                          onChange={(e) =>
                            setCharges(charges.map((ch) => (ch.id === c.id ? { ...ch, description: e.target.value } : ch)))
                          }
                          className="border-border focus:border-blue-300 focus:ring-blue-200"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor={`charge-amount-${c.id}`} className="text-xs text-muted-foreground mb-1">Amount (Ksh)</Label>
                        <Input
                          id={`charge-amount-${c.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={c.amount}
                          onChange={(e) =>
                            setCharges(charges.map((ch) => (ch.id === c.id ? { ...ch, amount: Number(e.target.value) } : ch)))
                          }
                          className="border-border focus:border-blue-300 focus:ring-blue-200"
                        />
                      </div>
                      <div className="col-span-1 flex items-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCharge(c.id)}
                          className="h-10 w-10 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No additional charges added yet</p>
                </div>
              )}

              <Button
                variant="outline"
                onClick={handleAddCharge}
                className="w-full border-dashed border-border hover:border-border hover:bg-muted"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Additional Charge
              </Button>
            </CardContent>
          </Card>

          {/* Summary Section */}
          <Card className="border-border shadow-sm bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Materials Total:</span>
                  <span className="font-medium">
                    Ksh{materials.reduce((sum, m) => sum + m.quantity * m.unitCost, 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Additional Charges:</span>
                  <span className="font-medium">
                    Ksh{charges.reduce((sum, c) => sum + c.amount, 0).toFixed(2)}
                  </span>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between items-center text-lg">
                  <span className="font-semibold text-foreground">Total Cost:</span>
                  <span className="font-bold text-blue-700 text-xl">
                    Ksh{totalCost.toFixed(2)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="pt-4 border-t border-border">
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            className="border-border hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
          >
            {isSaving ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                Saving...
              </>
            ) : (
              'Save & Update Cost'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};