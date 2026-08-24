import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GeocodeStatus = "found" | "pending" | "not_found";

interface StatusBadgeProps {
  status: GeocodeStatus;
  className?: string;
}

const STATUS_CONFIG: Record<GeocodeStatus, { label: string; className: string }> = {
  found: {
    label: "✅ Найден",
    className: "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200",
  },
  pending: {
    label: "⏳ Ожидает",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  },
  not_found: {
    label: "❌ Не найден",
    className: "bg-red-500/10 text-red-600 border-red-200",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge variant="secondary" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
