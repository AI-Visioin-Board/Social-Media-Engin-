import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Clock, Download, Upload, MessageSquare,
  FileText, TrendingUp, Star, LogOut, ChevronRight, Loader2,
  ArrowUpCircle, Send, Paperclip, X, Building2, Globe, Phone, MapPin
} from "lucide-react";
import { PHASE_LABELS, TIER_PHASES } from "../../../drizzle/schema";

const PHASE_DESCRIPTIONS: Record<string, string> = {
  onboarding: "We gather all the information needed to begin optimizing your AI visibility.",
  ai_audit: "We analyze how your business appears across AI platforms like ChatGPT, Gemini, and Perplexity.",
  gbp_optimization: "Your Google Business Profile is fully optimized to maximize AI and local search visibility.",
  schema_markup: "We implement structured data markup so AI systems can accurately understand your business.",
  citation_audit: "We audit and clean up your business listings across directories and data aggregators.",
  review_strategy: "We build a system to generate authentic 5-star reviews that boost your AI reputation.",
  content_optimization: "We optimize your website content to align with how AI platforms describe businesses.",
  competitor_analysis: "We analyze your top competitors' AI visibility strategies to find your edge.",
  final_report: "You receive a comprehensive report of all work completed and results achieved.",
  follow_up: "We check in 30 days later to measure results and fine-tune your strategy.",
};

function formatFileSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    processing: { label: "In Progress", className: "bg-blue-100 text-blue-800 border-blue-200" },
    completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
    cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 border-red-200" },
  };
  const s = map[status] ?? { label: status, className: "bg-gray-100 text-gray-700" };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.className}`}>{s.label}</span>;
}

export default function ClientPortal() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("progress");
  const [messageText, setMessageText] = useState("");
  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: session, isLoading: sessionLoading } = trpc.portal.me.useQuery();
  const { data: portalData, isLoading: dataLoading, refetch } = trpc.portal.getOrder.useQuery(
    undefined,
    { enabled: !!session }
  );

  const sendMessage = trpc.portal.sendMessage.useMutation({
    onSuccess: () => {
      setMessageText("");
      refetch();
      toast.success("Message sent!");
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadDocument = trpc.portal.uploadDocument.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Document uploaded successfully!");
    },
    onError: (e) => toast.error(e.message),
  });

  const requestUpgrade = trpc.portal.requestUpgrade.useMutation({
    onSuccess: () => {
      setUpgradeRequested(true);
      toast.success("Upgrade request sent! We'll be in touch shortly.");
    },
    onError: (e) => toast.error(e.message),
  });

  const logout = trpc.portal.logout.useMutation({
    onSuccess: () => navigate("/portal/login"),
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [portalData?.messages]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!sessionLoading && !session) {
      navigate("/portal/login");
    }
  }, [session, sessionLoading, navigate]);

  if (sessionLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading your portal...</p>
        </div>
      </div>
    );
  }

  if (!session || !portalData) {
    return null; // Will redirect
  }

  const { order, tierPhases, phaseProgress, deliverables, messages, uploads } = portalData;

  // Build progress map
  const progressMap = new Map(phaseProgress.map(p => [p.phase, p]));
  const completedPhases = tierPhases.filter(ph => progressMap.get(ph)?.completedAt != null);
  const currentPhaseIndex = tierPhases.indexOf(order.currentPhase as any);
  const progressPercent = tierPhases.length > 0
    ? Math.round((completedPhases.length / tierPhases.length) * 100)
    : 0;

  const unreadAdminMessages = messages.filter(m => m.sender === "admin").length;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDocument.mutate({
        name: file.name,
        fileBase64: base64,
        mimeType: file.type,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Star className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm leading-tight">SuggestedByGPT</p>
              <p className="text-xs text-slate-500 leading-tight">Client Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-900">{session.clientName}</p>
              <p className="text-xs text-slate-500">{session.businessName}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              className="text-slate-500 hover:text-slate-700"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Hero summary card */}
        <Card className="border-0 shadow-sm bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 opacity-80" />
                  <span className="text-indigo-100 text-sm">{order.businessName}</span>
                </div>
                <h1 className="text-2xl font-bold">
                  {order.serviceTier === "ai_dominator" ? "AI Dominator" : "AI Jumpstart"} Package
                </h1>
                <p className="text-indigo-200 text-sm mt-1">
                  Currently: <span className="text-white font-medium">{PHASE_LABELS[order.currentPhase as keyof typeof PHASE_LABELS] ?? order.currentPhase}</span>
                </p>
              </div>
              <div className="text-center sm:text-right">
                <div className="text-4xl font-bold">{progressPercent}%</div>
                <div className="text-indigo-200 text-sm">Complete</div>
                <StatusBadge status={order.status} />
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-4">
              <div className="h-2 bg-indigo-500 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-indigo-200 mt-1">
                <span>{completedPhases.length} of {tierPhases.length} phases complete</span>
                <span>{tierPhases.length - completedPhases.length} remaining</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick info row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {order.websiteUrl && (
            <a href={order.websiteUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-slate-200 text-sm text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors">
              <Globe className="h-4 w-4 shrink-0" />
              <span className="truncate">Website</span>
            </a>
          )}
          {order.businessPhone && (
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-slate-200 text-sm text-slate-600">
              <Phone className="h-4 w-4 shrink-0" />
              <span className="truncate">{order.businessPhone}</span>
            </div>
          )}
          {order.businessAddress && (
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-slate-200 text-sm text-slate-600 col-span-2">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{order.businessAddress}</span>
            </div>
          )}
        </div>

        {/* Main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 rounded-lg w-full sm:w-auto">
            <TabsTrigger value="progress" className="text-xs sm:text-sm">
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              Progress
            </TabsTrigger>
            <TabsTrigger value="deliverables" className="text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Deliverables
              {deliverables.length > 0 && (
                <span className="ml-1.5 bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 text-xs">{deliverables.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="messages" className="text-xs sm:text-sm">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Messages
              {messages.filter(m => m.sender === "admin").length > 0 && (
                <span className="ml-1.5 bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 text-xs">{messages.filter(m => m.sender === "admin").length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="uploads" className="text-xs sm:text-sm">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              My Files
            </TabsTrigger>
          </TabsList>

          {/* ── Progress Tab ── */}
          <TabsContent value="progress" className="mt-4 space-y-3">
            <p className="text-sm text-slate-500">Here's a detailed breakdown of every phase in your service package and where we currently stand.</p>
            {tierPhases.map((phase, index) => {
              const prog = progressMap.get(phase);
              const isCompleted = prog?.completedAt != null;
              const isCurrent = phase === order.currentPhase;
              const isPast = index < currentPhaseIndex;
              const isFuture = index > currentPhaseIndex && !isCompleted;

              return (
                <Card key={phase} className={`border transition-all ${isCompleted ? "border-green-200 bg-green-50/50" : isCurrent ? "border-indigo-300 bg-indigo-50/50 shadow-sm" : "border-slate-200 bg-white"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {isCompleted ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : isCurrent ? (
                          <Clock className="h-5 w-5 text-indigo-500 animate-pulse" />
                        ) : (
                          <Circle className="h-5 w-5 text-slate-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-slate-400 font-mono">Phase {index + 1}</span>
                          <h3 className={`font-semibold text-sm ${isCompleted ? "text-green-800" : isCurrent ? "text-indigo-800" : "text-slate-600"}`}>
                            {PHASE_LABELS[phase as keyof typeof PHASE_LABELS] ?? phase}
                          </h3>
                          {isCompleted && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Complete</span>}
                          {isCurrent && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">In Progress</span>}
                        </div>
                        <p className={`text-xs mt-1 ${isCompleted ? "text-green-700" : isCurrent ? "text-indigo-600" : "text-slate-400"}`}>
                          {PHASE_DESCRIPTIONS[phase] ?? ""}
                        </p>
                        {isCompleted && prog?.completedAt && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Completed {new Date(prog.completedAt).toLocaleDateString()}
                          </p>
                        )}
                        {prog?.notes && (
                          <p className="text-xs text-slate-500 mt-1 italic">Note: {prog.notes}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          {/* ── Deliverables Tab ── */}
          <TabsContent value="deliverables" className="mt-4">
            {deliverables.length === 0 ? (
              <Card className="border-dashed border-slate-300">
                <CardContent className="py-12 text-center">
                  <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">No deliverables yet</p>
                  <p className="text-slate-400 text-sm mt-1">Your reports, audits, and files will appear here as each phase is completed.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">All files and reports delivered to you. Click to download.</p>
                {deliverables.map((d) => (
                  <Card key={d.id} className="border-slate-200 hover:border-indigo-200 transition-colors">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">{d.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400 capitalize">
                            {PHASE_LABELS[d.phase as keyof typeof PHASE_LABELS] ?? d.phase}
                          </span>
                          {d.fileSize && (
                            <span className="text-xs text-slate-400">· {formatFileSize(d.fileSize)}</span>
                          )}
                          <span className="text-xs text-slate-400">· {new Date(d.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={d.name}
                        className="shrink-0"
                      >
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Upsell section for Jumpstart clients */}
            {order.serviceTier === "ai_jumpstart" && (
              <Card className="mt-6 border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
                      <ArrowUpCircle className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900">Upgrade to AI Dominator</h3>
                      <p className="text-sm text-slate-600 mt-1">
                        Get 3 additional phases: Content Optimization, Competitor Analysis, and a 30-Day Follow-Up check-in.
                        Maximize your AI visibility across every platform.
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {["Content Optimization", "Competitor Analysis", "30-Day Follow-Up"].map(f => (
                          <span key={f} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">✓ {f}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 mt-4">
                        <span className="text-2xl font-bold text-indigo-700">$199</span>
                        <span className="text-slate-400 text-sm">one-time upgrade</span>
                      </div>
                      {upgradeRequested ? (
                        <div className="mt-3 flex items-center gap-2 text-green-700 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4" />
                          Request sent! We'll reach out shortly.
                        </div>
                      ) : (
                        <Button
                          className="mt-3 bg-indigo-600 hover:bg-indigo-700"
                          onClick={() => requestUpgrade.mutate()}
                          disabled={requestUpgrade.isPending}
                        >
                          {requestUpgrade.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Request Upgrade
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Messages Tab ── */}
          <TabsContent value="messages" className="mt-4">
            <Card className="border-slate-200">
              <CardHeader className="pb-3 border-b border-slate-100">
                <CardTitle className="text-base">Messages with SuggestedByGPT</CardTitle>
                <CardDescription>Ask questions, share updates, or request clarification on any phase.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {/* Message list */}
                <div className="h-80 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <MessageSquare className="h-8 w-8 text-slate-300 mb-2" />
                      <p className="text-slate-400 text-sm">No messages yet. Send us a message below!</p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === "client" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                          msg.sender === "client"
                            ? "bg-indigo-600 text-white rounded-br-sm"
                            : "bg-slate-100 text-slate-800 rounded-bl-sm"
                        }`}>
                          <p className="leading-relaxed">{msg.content}</p>
                          <p className={`text-xs mt-1 ${msg.sender === "client" ? "text-indigo-200" : "text-slate-400"}`}>
                            {msg.sender === "client" ? "You" : "SuggestedByGPT"} · {new Date(msg.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
                {/* Message input */}
                <div className="p-4 border-t border-slate-100">
                  <div className="flex gap-2">
                    <Textarea
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Type your message..."
                      className="resize-none min-h-[60px] text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (messageText.trim()) sendMessage.mutate({ content: messageText.trim() });
                        }
                      }}
                    />
                    <Button
                      onClick={() => { if (messageText.trim()) sendMessage.mutate({ content: messageText.trim() }); }}
                      disabled={!messageText.trim() || sendMessage.isPending}
                      className="bg-indigo-600 hover:bg-indigo-700 self-end"
                      size="sm"
                    >
                      {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">Press Enter to send, Shift+Enter for new line</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── My Files / Uploads Tab ── */}
          <TabsContent value="uploads" className="mt-4 space-y-4">
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Upload Documents</CardTitle>
                <CardDescription>
                  Share intake forms, logos, login credentials, photos, or any other files we need to complete your service.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                />
                <Button
                  variant="outline"
                  className="w-full h-24 border-dashed border-2 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 flex flex-col gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadDocument.isPending}
                >
                  {uploadDocument.isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                  ) : (
                    <Upload className="h-6 w-6 text-slate-400" />
                  )}
                  <span className="text-sm text-slate-500">
                    {uploadDocument.isPending ? "Uploading..." : "Click to upload a file (max 10MB)"}
                  </span>
                </Button>
                <p className="text-xs text-slate-400 mt-2">Accepted: Images, PDF, Word, Excel, CSV, TXT, ZIP</p>
              </CardContent>
            </Card>

            {uploads.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-700">Your Uploaded Files</h3>
                {uploads.map((u) => (
                  <Card key={u.id} className="border-slate-200">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center shrink-0">
                        <Paperclip className="h-4 w-4 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{u.name}</p>
                        <p className="text-xs text-slate-400">
                          {formatFileSize(u.fileSize)} · {new Date(u.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <a href={u.fileUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
