import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { ArrowLeft, Loader2, Sparkles, Zap, Mail, Copy, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function NewOrder() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [welcomeEmailData, setWelcomeEmailData] = useState<{
    subject: string;
    body: string;
    clientEmail: string;
    portalUrl: string | null;
    orderId: number;
  } | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    businessName: "",
    websiteUrl: "",
    businessAddress: "",
    businessPhone: "",
    businessCategory: "",
    targetArea: "",
    serviceTier: "" as string,
    notes: "",
  });

  const createOrder = trpc.orders.create.useMutation({
    onSuccess: (order) => {
      toast.success("Order created! Welcome email is ready to send.");
      utils.orders.list.invalidate();
      utils.orders.stats.invalidate();
      if (order?.welcomeEmail) {
        setWelcomeEmailData({
          subject: order.welcomeEmail.subject,
          body: order.welcomeEmail.body,
          clientEmail: order.clientEmail,
          portalUrl: order.portalUrl ?? null,
          orderId: order.id,
        });
      } else if (order) {
        setLocation(`/orders/${order.id}`);
      } else {
        setLocation("/");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create order");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientName || !form.clientEmail || !form.businessName || !form.serviceTier) {
      toast.error("Please fill in all required fields");
      return;
    }
    createOrder.mutate({
      ...form,
      serviceTier: form.serviceTier as "ai_jumpstart" | "ai_dominator",
      websiteUrl: form.websiteUrl || undefined,
      businessAddress: form.businessAddress || undefined,
      businessPhone: form.businessPhone || undefined,
      businessCategory: form.businessCategory || undefined,
      targetArea: form.targetArea || undefined,
      notes: form.notes || undefined,
      origin: window.location.origin,
    });
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Order</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Create a new client service order
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Service Tier Selection */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Service Tier</CardTitle>
            <CardDescription>Select the service package for this client</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => updateField("serviceTier", "ai_jumpstart")}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  form.serviceTier === "ai_jumpstart"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-5 w-5 text-sky-500" />
                  <span className="font-semibold">AI Jumpstart</span>
                </div>
                <p className="text-2xl font-bold">$99</p>
                <p className="text-xs text-muted-foreground mt-1">
                  7 phases: Audit, Schema, Citations, Reviews, GBP, Report
                </p>
              </button>
              <button
                type="button"
                onClick={() => updateField("serviceTier", "ai_dominator")}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  form.serviceTier === "ai_dominator"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  <span className="font-semibold">AI Dominator</span>
                </div>
                <p className="text-2xl font-bold">$199</p>
                <p className="text-xs text-muted-foreground mt-1">
                  All 10 phases: + Content, Competitors, Follow-Up
                </p>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Client Information */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Client Information</CardTitle>
            <CardDescription>Contact details for the client</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name *</Label>
                <Input
                  id="clientName"
                  value={form.clientName}
                  onChange={(e) => updateField("clientName", e.target.value)}
                  placeholder="John Smith"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientEmail">Client Email *</Label>
                <Input
                  id="clientEmail"
                  type="email"
                  value={form.clientEmail}
                  onChange={(e) => updateField("clientEmail", e.target.value)}
                  placeholder="john@business.com"
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Information */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Business Information</CardTitle>
            <CardDescription>Details about the client's business</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name *</Label>
                <Input
                  id="businessName"
                  value={form.businessName}
                  onChange={(e) => updateField("businessName", e.target.value)}
                  placeholder="Smith's Plumbing"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="websiteUrl">Website URL</Label>
                <Input
                  id="websiteUrl"
                  value={form.websiteUrl}
                  onChange={(e) => updateField("websiteUrl", e.target.value)}
                  placeholder="https://smithsplumbing.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="businessAddress">Business Address</Label>
                <Input
                  id="businessAddress"
                  value={form.businessAddress}
                  onChange={(e) => updateField("businessAddress", e.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessPhone">Phone Number</Label>
                <Input
                  id="businessPhone"
                  value={form.businessPhone}
                  onChange={(e) => updateField("businessPhone", e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="businessCategory">Business Category</Label>
                <Input
                  id="businessCategory"
                  value={form.businessCategory}
                  onChange={(e) => updateField("businessCategory", e.target.value)}
                  placeholder="Plumbing, HVAC, etc."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetArea">Target Geographic Area</Label>
                <Input
                  id="targetArea"
                  value={form.targetArea}
                  onChange={(e) => updateField("targetArea", e.target.value)}
                  placeholder="Kansas City Metro"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Additional Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Any additional information about the client or their needs..."
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setLocation("/")}>
            Cancel
          </Button>
          <Button type="submit" disabled={createOrder.isPending}>
            {createOrder.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Order
          </Button>
        </div>
      </form>

      {/* Welcome Email Dialog */}
      <Dialog open={!!welcomeEmailData} onOpenChange={(open) => {
        if (!open && welcomeEmailData) {
          setLocation(`/orders/${welcomeEmailData.orderId}`);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-indigo-600" />
              Order Created — Send Welcome Email
            </DialogTitle>
            <DialogDescription>
              The order has been created and a portal link has been generated. Copy the email below and send it to your client, or use the Gmail button to send it directly.
            </DialogDescription>
          </DialogHeader>

          {welcomeEmailData && (
            <div className="space-y-4 mt-2">
              {welcomeEmailData.portalUrl && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-800 mb-1">Client Portal Link (7 days)</p>
                  <p className="text-xs font-mono text-indigo-700 break-all">{welcomeEmailData.portalUrl}</p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Email Preview</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      const full = `To: ${welcomeEmailData.clientEmail}\nSubject: ${welcomeEmailData.subject}\n\n${welcomeEmailData.body}`;
                      navigator.clipboard.writeText(full);
                      setEmailCopied(true);
                      setTimeout(() => setEmailCopied(false), 2000);
                      toast.success("Email copied to clipboard!");
                    }}
                  >
                    {emailCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {emailCopied ? "Copied!" : "Copy Email"}
                  </Button>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  <p className="font-semibold text-slate-500 mb-2">To: {welcomeEmailData.clientEmail}</p>
                  <p className="font-semibold text-slate-500 mb-3">Subject: {welcomeEmailData.subject}</p>
                  {welcomeEmailData.body}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 gap-2"
                  onClick={() => {
                    // Open Gmail compose with pre-filled data
                    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(welcomeEmailData.clientEmail)}&su=${encodeURIComponent(welcomeEmailData.subject)}&body=${encodeURIComponent(welcomeEmailData.body)}`;
                    window.open(gmailUrl, "_blank");
                    toast.success("Gmail opened with pre-filled email!");
                  }}
                >
                  <Mail className="h-4 w-4" />
                  Open in Gmail
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setLocation(`/orders/${welcomeEmailData.orderId}`)}
                >
                  Go to Order
                </Button>
              </div>

              <p className="text-xs text-slate-400 text-center">
                The portal link is already saved. You can resend it anytime from the order detail page.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
