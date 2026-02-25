import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, Star, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * This page handles two scenarios:
 * 1. /portal/login — shown when no token is present (or session expired)
 * 2. /portal/:token — auto-validates the magic link token from the URL
 */
export default function ClientPortalLogin() {
  const [, navigate] = useLocation();
  const params = useParams<{ token?: string }>();
  const token = params.token;

  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const validateToken = trpc.portal.validateToken.useMutation({
    onSuccess: () => {
      setStatus("success");
      setTimeout(() => navigate("/portal"), 1200);
    },
    onError: (e) => {
      setStatus("error");
      setErrorMsg(e.message);
    },
  });

  useEffect(() => {
    if (token && token !== "login") {
      setStatus("validating");
      validateToken.mutate({ token });
    }
  }, [token]);

  // ── Validating state ──
  if (status === "validating") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-slate-700 font-medium">Verifying your access link...</p>
          <p className="text-slate-400 text-sm mt-1">This will only take a moment.</p>
        </div>
      </div>
    );
  }

  // ── Success state ──
  if (status === "success") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="h-8 w-8 text-green-600" />
          </div>
          <p className="text-slate-900 font-semibold text-lg">Access Verified!</p>
          <p className="text-slate-500 text-sm mt-1">Redirecting to your portal...</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-red-200">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Link Invalid or Expired</h2>
            <p className="text-slate-500 text-sm mb-6">{errorMsg || "This access link is no longer valid. Please contact SuggestedByGPT to receive a new link."}</p>
            <a href="mailto:support@suggestedbygpt.com">
              <Button variant="outline" className="w-full">
                Contact Support
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Default: no token / /portal/login ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Star className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">SuggestedByGPT</h1>
          <p className="text-slate-400 text-sm mt-1">Client Portal</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardContent className="p-8">
            <h2 className="text-xl font-bold text-slate-900 mb-2 text-center">Access Your Portal</h2>
            <p className="text-slate-500 text-sm text-center mb-6">
              Your portal is accessed via a secure link sent to your email. Check your inbox for a message from SuggestedByGPT.
            </p>

            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 mb-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-slate-800">Secure Magic Link Login</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    No password needed. We send you a unique secure link that gives you access to your order dashboard, deliverables, and messaging.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                Check your email for a link from SuggestedByGPT
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                Click the "Access My Portal" button in the email
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                You'll be taken directly to your dashboard
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 text-center">
              <p className="text-xs text-slate-400">
                Don't have a link?{" "}
                <a href="mailto:support@suggestedbygpt.com" className="text-indigo-600 hover:underline">
                  Contact us
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
