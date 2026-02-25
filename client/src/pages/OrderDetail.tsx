import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  Send,
  Upload,
  Trash2,
  FileText,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Zap,
  Link2,
  Copy,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

const PHASE_LABELS: Record<string, string> = {
  onboarding: "Client Onboarding",
  ai_audit: "AI Visibility Audit",
  gbp_optimization: "GBP Optimization",
  schema_markup: "Schema Markup",
  citation_audit: "Citation Audit",
  review_strategy: "Review Strategy",
  content_optimization: "Content Optimization",
  competitor_analysis: "Competitor Analysis",
  final_report: "Final Report & Delivery",
  follow_up: "30-Day Follow-Up",
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  onboarding: "Collect intake info, validate completeness",
  ai_audit: "Test AI platforms, score current visibility",
  gbp_optimization: "Audit/create/optimize Google Business Profile",
  schema_markup: "Generate and implement structured data",
  citation_audit: "Scan directories, check NAP consistency",
  review_strategy: "Audit reviews, create request templates",
  content_optimization: "Rewrite website content for AI extractability",
  competitor_analysis: "Reverse-engineer top competitors",
  final_report: "Compile deliverables, upload to portal",
  follow_up: "Re-test, compare, adjust after 30 days",
};

const TIER_PHASES: Record<string, string[]> = {
  ai_jumpstart: [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "final_report",
  ],
  ai_dominator: [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "content_optimization",
    "competitor_analysis", "final_report", "follow_up",
  ],
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

const QA_STEPS = [
  { key: "qaExecute", label: "Execute", desc: "Complete the work" },
  { key: "qaVerify", label: "Verify", desc: "Confirm output is correct" },
  { key: "qaTest", label: "Test", desc: "Confirm it actually works" },
  { key: "qaDocument", label: "Document", desc: "Screenshot evidence" },
] as const;

export default function OrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = parseInt(params.id ?? "0", 10);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: order, isLoading } = trpc.orders.get.useQuery(
    { id: orderId },
    { enabled: orderId > 0 }
  );
  const { data: phaseData } = trpc.phases.getByOrder.useQuery(
    { orderId },
    { enabled: orderId > 0 }
  );
  const { data: messagesData } = trpc.messages.listByOrder.useQuery(
    { orderId },
    { enabled: orderId > 0 }
  );
  const { data: deliverablesData } = trpc.deliverables.listByOrder.useQuery(
    { orderId },
    { enabled: orderId > 0 }
  );

  const updateOrder = trpc.orders.update.useMutation({
    onSuccess: () => {
      utils.orders.get.invalidate({ id: orderId });
      utils.orders.list.invalidate();
      utils.orders.stats.invalidate();
      toast.success("Order updated");
    },
  });

  const updateQA = trpc.phases.updateQA.useMutation({
    onSuccess: () => {
      utils.phases.getByOrder.invalidate({ orderId });
    },
  });

  const sendMessage = trpc.messages.create.useMutation({
    onSuccess: () => {
      utils.messages.listByOrder.invalidate({ orderId });
      utils.messages.unreadCount.invalidate();
      setNewMessage("");
      toast.success("Message sent");
    },
  });

  const uploadDeliverable = trpc.deliverables.upload.useMutation({
    onSuccess: () => {
      utils.deliverables.listByOrder.invalidate({ orderId });
      toast.success("File uploaded");
    },
    onError: (err) => {
      toast.error(err.message || "Upload failed");
    },
  });

  const deleteDeliverable = trpc.deliverables.delete.useMutation({
    onSuccess: () => {
      utils.deliverables.listByOrder.invalidate({ orderId });
      toast.success("File deleted");
    },
  });

  const [newMessage, setNewMessage] = useState("");
  const [uploadPhase, setUploadPhase] = useState<string>("");
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [showPortalLink, setShowPortalLink] = useState(false);

  const generatePortalLink = trpc.orders.generatePortalLink.useMutation({
    onSuccess: (data) => {
      setPortalLink(data.portalUrl);
      setShowPortalLink(true);
      toast.success("Portal link generated!");
    },
    onError: (e) => toast.error(e.message),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesData]);

  const phaseProgressMap = useMemo(() => {
    const map: Record<string, any> = {};
    if (phaseData) {
      for (const p of phaseData) {
        map[p.phase] = p;
      }
    }
    return map;
  }, [phaseData]);

  const applicablePhases = useMemo(() => {
    if (!order) return [];
    return TIER_PHASES[order.serviceTier] ?? [];
  }, [order]);

  const completedPhaseCount = useMemo(() => {
    return applicablePhases.filter((p) => phaseProgressMap[p]?.completedAt).length;
  }, [applicablePhases, phaseProgressMap]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="link" onClick={() => setLocation("/")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadPhase) {
      toast.error("Please select a phase first");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDeliverable.mutate({
        orderId,
        phase: uploadPhase,
        name: file.name,
        fileBase64: base64,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    sendMessage.mutate({
      orderId,
      sender: "admin",
      content: newMessage.trim(),
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{order.businessName}</h1>
              <Badge variant="outline" className={STATUS_COLORS[order.status] ?? ""}>
                {order.status}
              </Badge>
              <Badge
                variant="outline"
                className={
                  order.serviceTier === "ai_dominator"
                    ? "bg-purple-50 text-purple-700 border-purple-200"
                    : "bg-sky-50 text-sky-700 border-sky-200"
                }
              >
                {order.serviceTier === "ai_dominator" ? (
                  <><Sparkles className="h-3 w-3 mr-1" />AI Dominator</>
                ) : (
                  <><Zap className="h-3 w-3 mr-1" />AI Jumpstart</>
                )}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {order.clientName} &middot; {order.clientEmail}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-10 sm:ml-0 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
            onClick={() => generatePortalLink.mutate({ orderId, origin: window.location.origin })}
            disabled={generatePortalLink.isPending}
          >
            {generatePortalLink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Send Portal Link
          </Button>
          <Select
            value={order.status}
            onValueChange={(val) => updateOrder.mutate({ id: orderId, status: val as any })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Portal link banner */}
      {showPortalLink && portalLink && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <Link2 className="h-4 w-4 text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-indigo-800 mb-0.5">Client Portal Link (valid 7 days)</p>
            <p className="text-xs text-indigo-600 truncate font-mono">{portalLink}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
            onClick={() => {
              navigator.clipboard.writeText(portalLink);
              toast.success("Link copied to clipboard!");
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-indigo-400 hover:text-indigo-700"
            onClick={() => setShowPortalLink(false)}
          >
            ✕
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="phases">
            Phases ({completedPhaseCount}/{applicablePhases.length})
          </TabsTrigger>
          <TabsTrigger value="messages">
            Messages {messagesData && messagesData.length > 0 ? `(${messagesData.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="deliverables">
            Deliverables {deliverablesData && deliverablesData.length > 0 ? `(${deliverablesData.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab ─── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Client Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <InfoRow label="Name" value={order.clientName} />
                <InfoRow label="Email" value={order.clientEmail} />
                <InfoRow label="Business" value={order.businessName} />
                <InfoRow label="Website" value={order.websiteUrl} link />
                <InfoRow label="Address" value={order.businessAddress} />
                <InfoRow label="Phone" value={order.businessPhone} />
                <InfoRow label="Category" value={order.businessCategory} />
                <InfoRow label="Target Area" value={order.targetArea} />
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Order Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <InfoRow label="Order ID" value={`#${order.id}`} />
                <InfoRow
                  label="Service Tier"
                  value={order.serviceTier === "ai_dominator" ? "AI Dominator ($199)" : "AI Jumpstart ($99)"}
                />
                <InfoRow label="Status" value={order.status} />
                <InfoRow label="Current Phase" value={PHASE_LABELS[order.currentPhase] ?? order.currentPhase} />
                <InfoRow label="Welcome Email" value={order.welcomeEmailSent ? "Sent" : "Not sent"} />
                <InfoRow label="Created" value={new Date(order.createdAt).toLocaleString()} />
                <InfoRow label="Updated" value={new Date(order.updatedAt).toLocaleString()} />
                <div className="pt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Progress</span>
                    <span>{completedPhaseCount}/{applicablePhases.length} phases</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2 transition-all"
                      style={{
                        width: `${applicablePhases.length > 0 ? (completedPhaseCount / applicablePhases.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {order.notes && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Phases Tab ─── */}
        <TabsContent value="phases" className="space-y-3">
          {applicablePhases.map((phase, index) => {
            const progress = phaseProgressMap[phase];
            const isComplete = !!progress?.completedAt;
            const isCurrent = order.currentPhase === phase;

            return (
              <Card
                key={phase}
                className={`border shadow-sm transition-all ${
                  isCurrent ? "ring-2 ring-primary/30 border-primary/40" : ""
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Phase indicator */}
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          isComplete
                            ? "bg-emerald-100 text-emerald-700"
                            : isCurrent
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isComplete ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          index + 1
                        )}
                      </div>
                    </div>

                    {/* Phase content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">
                          {PHASE_LABELS[phase]}
                        </h3>
                        {isComplete && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                            Complete
                          </Badge>
                        )}
                        {isCurrent && !isComplete && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            Current
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {PHASE_DESCRIPTIONS[phase]}
                      </p>

                      {/* QA Verification Steps */}
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {QA_STEPS.map((qa) => {
                          const checked = progress?.[qa.key] ?? false;
                          return (
                            <label
                              key={qa.key}
                              className={`flex items-center gap-2 p-2 rounded-md border text-xs transition-colors ${
                                checked
                                  ? "bg-emerald-50 border-emerald-200"
                                  : "bg-background border-border hover:bg-muted/50"
                              }`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(val) => {
                                  updateQA.mutate({
                                    orderId,
                                    phase,
                                    [qa.key]: !!val,
                                  });
                                }}
                              />
                              <div>
                                <span className="font-medium">{qa.label}</span>
                                <p className="text-muted-foreground leading-tight hidden sm:block">
                                  {qa.desc}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {/* Advance phase button */}
                      {isCurrent && isComplete && (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const currentIdx = applicablePhases.indexOf(phase);
                              if (currentIdx < applicablePhases.length - 1) {
                                updateOrder.mutate({
                                  id: orderId,
                                  currentPhase: applicablePhases[currentIdx + 1],
                                });
                              }
                            }}
                          >
                            Advance to Next Phase
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ─── Messages Tab ─── */}
        <TabsContent value="messages" className="space-y-4">
          <Card className="border shadow-sm">
            <CardContent className="p-4">
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {!messagesData || messagesData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No messages yet. Start a conversation below.
                  </p>
                ) : (
                  messagesData.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === "admin" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                          msg.sender === "admin"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium opacity-80">
                            {msg.sender === "admin" ? "You" : "Client"}
                          </span>
                          <span className="text-xs opacity-60">
                            {new Date(msg.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t">
                <Textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  rows={2}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sendMessage.isPending}
                  className="self-end"
                >
                  {sendMessage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Deliverables Tab ─── */}
        <TabsContent value="deliverables" className="space-y-4">
          {/* Upload Section */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upload Deliverable</CardTitle>
              <CardDescription>Select a phase and upload a file (max 10MB)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={uploadPhase} onValueChange={setUploadPhase}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Select phase" />
                  </SelectTrigger>
                  <SelectContent>
                    {applicablePhases.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PHASE_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!uploadPhase) {
                        toast.error("Please select a phase first");
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    disabled={uploadDeliverable.isPending}
                    className="w-full sm:w-auto"
                  >
                    {uploadDeliverable.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Choose File
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Deliverables List */}
          {applicablePhases.map((phase) => {
            const phaseDeliverables = deliverablesData?.filter((d) => d.phase === phase) ?? [];
            if (phaseDeliverables.length === 0) return null;

            return (
              <Card key={phase} className="border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {PHASE_LABELS[phase]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {phaseDeliverables.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-3 rounded-md border bg-muted/20"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{d.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.fileSize ? `${(d.fileSize / 1024).toFixed(1)} KB` : ""} &middot;{" "}
                            {new Date(d.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(d.fileUrl, "_blank")}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteDeliverable.mutate({ id: d.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}

          {(!deliverablesData || deliverablesData.length === 0) && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No deliverables uploaded yet. Use the upload section above to add files.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({
  label,
  value,
  link,
}: {
  label: string;
  value: string | null | undefined;
  link?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      {link ? (
        <a
          href={value.startsWith("http") ? value : `https://${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline truncate text-right"
        >
          {value}
        </a>
      ) : (
        <span className="text-right truncate">{value}</span>
      )}
    </div>
  );
}
