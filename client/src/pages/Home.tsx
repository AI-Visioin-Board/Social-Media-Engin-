import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  Loader2,
  Plus,
  MessageSquare,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

const TIER_LABELS: Record<string, string> = {
  ai_jumpstart: "AI Jumpstart",
  ai_dominator: "AI Dominator",
};

export default function Home() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: stats, isLoading: statsLoading } = trpc.orders.stats.useQuery();
  const { data: orders, isLoading: ordersLoading } = trpc.orders.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter as any } : undefined
  );
  const { data: unreadCount } = trpc.messages.unreadCount.useQuery();

  const isLoading = statsLoading || ordersLoading;

  const statCards = useMemo(() => [
    {
      title: "Total Orders",
      value: stats?.total ?? 0,
      icon: ClipboardList,
      color: "text-foreground",
      bg: "bg-secondary",
    },
    {
      title: "Pending",
      value: stats?.pending ?? 0,
      icon: Clock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Processing",
      value: stats?.processing ?? 0,
      icon: Loader2,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Completed",
      value: stats?.completed ?? 0,
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ], [stats]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your client orders and service delivery
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(unreadCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
              <MessageSquare className="h-4 w-4" />
              <span>{unreadCount} unread message{unreadCount !== 1 ? "s" : ""}</span>
            </div>
          )}
          <Button onClick={() => setLocation("/orders/new")} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Order
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card key={card.title} className="border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {card.title}
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {isLoading ? "—" : card.value}
                  </p>
                </div>
                <div className={`h-10 w-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Orders Table */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Orders</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No orders found</p>
              <Button
                variant="link"
                size="sm"
                className="mt-2"
                onClick={() => setLocation("/orders/new")}
              >
                Create your first order
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setLocation(`/orders/${order.id}`)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{order.id}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{order.clientName}</p>
                          <p className="text-xs text-muted-foreground">{order.clientEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{order.businessName}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            order.serviceTier === "ai_dominator"
                              ? "bg-purple-50 text-purple-700 border-purple-200"
                              : "bg-sky-50 text-sky-700 border-sky-200"
                          }
                        >
                          {TIER_LABELS[order.serviceTier]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_COLORS[order.status] ?? ""}
                        >
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
