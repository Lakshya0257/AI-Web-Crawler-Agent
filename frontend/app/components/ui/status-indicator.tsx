import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

interface StatusIndicatorProps {
  status: 'idle' | 'running' | 'success' | 'error';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StatusIndicator({ status, size = 'md', className }: StatusIndicatorProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  const statusConfig = {
    idle: {
      bg: 'bg-muted',
      color: 'text-muted-foreground',
      icon: null
    },
    running: {
      bg: 'bg-warning',
      color: 'text-warning-foreground',
      icon: <Loader2 className={cn(sizeClasses[size], "animate-spin")} />
    },
    success: {
      bg: 'bg-success',
      color: 'text-success-foreground',
      icon: null
    },
    error: {
      bg: 'bg-destructive',
      color: 'text-destructive-foreground',
      icon: null
    }
  };

  const config = statusConfig[status];

  return (
    <div className={cn(
      "inline-flex items-center justify-center rounded-full",
      sizeClasses[size],
      config.bg,
      className
    )}>
      {config.icon || <div className={cn("rounded-full", sizeClasses[size === 'sm' ? 'sm' : size === 'md' ? 'sm' : 'md'], config.bg)} />}
    </div>
  );
} 