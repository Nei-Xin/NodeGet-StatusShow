import { ArrowDown, ArrowUp, Clock, type LucideIcon } from 'lucide-react'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { cpuLabel, deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import type { Node } from '../types'
import type { ReactNode } from 'react'

export function NodeCard({ node }: { node: Node }) {
  const u = deriveUsage(node)
  const tags = Array.isArray(node.meta?.tags) ? node.meta.tags : []
  const os = osLabel(node)
  const logo = distroLogo(node)
  const virt = virtLabel(node)
  const cpu = cpuLabel(node)

  return (
    <a href={`#${encodeURIComponent(node.uuid)}`} className="block">
      <Card
        className={cn(
          'p-4 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5 flex flex-col gap-3',
          !node.online && 'opacity-60 grayscale',
        )}
      >
        <div className="flex items-center gap-2">
          <StatusDot online={node.online} />
          {logo && (
            <img src={logo} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="font-semibold flex-1 min-w-0 truncate" title={displayName(node)}>
            {displayName(node)}
          </span>
          <Flag code={node.meta?.region} className="shrink-0" />
        </div>

        {(os || virt) && (
          <div className="flex">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded text-muted-foreground bg-secondary/50 truncate">
              {[os, virt].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <Metric label="CPU" value={u.cpu} sub={cpu || null} subTitle={cpu || undefined} />
          <Metric
            label="内存"
            value={u.mem}
            sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null}
          />
          <Metric
            label="磁盘"
            value={u.disk}
            sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null}
          />
        </div>

        <div className="p-2.5 mt-0.5 rounded-lg bg-muted/40 font-mono text-xs text-muted-foreground space-y-2">
          <div className="flex items-center justify-between">
            <Stat icon={ArrowDown}>{bytes(u.netIn || 0)}/s</Stat>
            <Stat icon={ArrowUp}>{bytes(u.netOut || 0)}/s</Stat>
          </div>
          <div className="flex items-center justify-between">
            <Stat icon={ArrowDown}>{bytes(node.dynamic?.total_received || 0)}</Stat>
            <Stat icon={ArrowUp}>{bytes(node.dynamic?.total_transmitted || 0)}</Stat>
          </div>
          <div className="flex items-center gap-3">
            <Stat icon={Clock}>{uptime(u.uptime)}</Stat>
            <span className="ml-auto">{relativeAge(u.ts)}</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {tags.map(t => (
              <Badge key={t} variant="secondary" className="text-[10px] font-normal bg-primary/10 text-primary hover:bg-primary/15 border-transparent">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </a>
  )
}

function Stat({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  )
}

function Metric({
  label,
  value,
  sub,
  subTitle,
}: {
  label: string
  value: number | undefined
  sub?: string | null
  subTitle?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{pct(value)}</span>
      </div>
      <Progress value={value} indicatorClassName={loadColor(value)} className="mt-1.5 h-1" />
      {sub && (
        <div
          className="font-mono text-[11px] text-muted-foreground mt-1 truncate"
          title={subTitle}
        >
          {sub}
        </div>
      )}
    </div>
  )
}
