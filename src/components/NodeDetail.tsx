import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { strokeColor } from '../utils/cn'
import { RpcClient } from '../api/client'
import { taskQuery } from '../api/methods'
import type { HistorySample, Node, SiteConfig, TaskRecord } from '../types'

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 11,
}

const PING_TASK_LIMIT = 5000
const PING_REFRESH_MS = 10_000
const PING_COLORS = ['#06b6d4', '#ef4444', '#8b5cf6', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#84cc16']
const ms = (v?: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} ms`)

const PING_RANGES = [
  { label: '1小时', hours: 1 },
  { label: '6小时', hours: 6 },
  { label: '12小时', hours: 12 },
  { label: '1天', hours: 24 },
  { label: '7天', hours: 24 * 7 },
] as const
type PingRangeHours = (typeof PING_RANGES)[number]['hours']

interface PingSeries {
  key: string
  label: string
  color: string
  points: PingPoint[]
}

interface PingChartData {
  series: PingSeries[]
}

interface PingPoint {
  t: number
  value: number
}

function seriesId(row: TaskRecord, resultKey: 'ping' | 'tcp_ping') {
  if (!row.cron_source) return ''
  return `${resultKey}:${row.cron_source}`
}

function pingChartData(pingRows: TaskRecord[], tcpPingRows: TaskRecord[]): PingChartData {
  const seriesLabels = new Map<string, string>()
  const values = new Map<string, PingPoint[]>()

  const add = (row: TaskRecord, resultKey: 'ping' | 'tcp_ping') => {
    const t = Number(row.timestamp)
    const value = Number(row.task_event_result?.[resultKey])
    if (!Number.isFinite(t) || !Number.isFinite(value)) return
    if (!row.cron_source) return
    const id = seriesId(row, resultKey)
    if (!id) return
    seriesLabels.set(id, String(row.cron_source))
    let points = values.get(id)
    if (!points) values.set(id, (points = []))
    points.push({ t, value })
  }

  for (const row of pingRows) add(row, 'ping')
  for (const row of tcpPingRows) add(row, 'tcp_ping')

  const series = [...seriesLabels.entries()].map(([id, label], i) => ({
    key: `s${i}`,
    label,
    color: PING_COLORS[i % PING_COLORS.length],
    points: (values.get(id) || []).sort((a, b) => a.t - b.t),
  }))

  return {
    series,
  }
}

interface Props {
  node: Node | null
  onClose: () => void
  showSource?: boolean
  siteTokens?: SiteConfig['site_tokens']
}

export function NodeDetail({ node, onClose, showSource, siteTokens = [] }: Props) {
  const [pingData, setPingData] = useState<PingChartData>({ series: [] })
  const [pingLoading, setPingLoading] = useState(false)
  const [pingError, setPingError] = useState<string | null>(null)
  const [pingRangeHours, setPingRangeHours] = useState<PingRangeHours>(1)

  useEffect(() => {
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [node, onClose])

  useEffect(() => {
    setPingData({ series: [] })
    setPingError(null)
    if (!node) return

    const token = siteTokens.find(t => t.name === node.source) ?? siteTokens[0]
    if (!token) return

    let alive = true
    const client = new RpcClient(token.backend_url, token.token, token.name)

    const load = async () => {
      if (alive) setPingLoading(true)
      try {
        const since = Date.now() - pingRangeHours * 60 * 60 * 1000
        const [pingRows, tcpPingRows] = await Promise.all([
          taskQuery(client, [
            { uuid: node.uuid },
            { type: 'ping' },
            'is_success',
            { timestamp_from: since },
            { limit: PING_TASK_LIMIT },
          ]),
          taskQuery(client, [
            { uuid: node.uuid },
            { type: 'tcp_ping' },
            'is_success',
            { timestamp_from: since },
            { limit: PING_TASK_LIMIT },
          ]),
        ])
        if (!alive) return
        setPingData(pingChartData(pingRows || [], tcpPingRows || []))
        setPingError(null)
      } catch (e) {
        if (!alive) return
        setPingError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setPingLoading(false)
      }
    }

    load()
    const timer = setInterval(load, PING_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
      client.close()
    }
  }, [node?.uuid, node?.source, pingRangeHours, siteTokens])

  if (!node) return null

  const u = deriveUsage(node)
  const d = node.dynamic
  const s = node.static?.system
  const cpu = node.static?.cpu
  const tags = node.meta?.tags ?? []
  const virt = virtLabel(node)
  const logo = distroLogo(node)
  const swap =
    d?.total_swap && d.used_swap != null ? (d.used_swap / d.total_swap) * 100 : undefined
  const loadAvg =
    d?.load_one != null && d?.load_five != null && d?.load_fifteen != null
      ? `${d.load_one.toFixed(2)} / ${d.load_five.toFixed(2)} / ${d.load_fifteen.toFixed(2)}`
      : null
  const history = node.history || []

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-150">
      <div className="sticky top-0 z-10 backdrop-blur-md bg-background/70 border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="返回" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <StatusDot online={node.online} />
          {logo && (
            <img src={logo} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="font-semibold truncate min-w-0">{displayName(node)}</span>
          <Flag code={node.meta?.region} className="shrink-0" />
          <span className="hidden md:inline truncate text-xs font-mono text-muted-foreground">
            {node.uuid}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5 shrink-0">
            {node.meta?.region && <Badge variant="secondary" className="font-normal bg-primary/10 text-primary hover:bg-primary/15 border-transparent">{node.meta.region}</Badge>}
            {showSource && (
              <Badge variant="secondary" className="hidden sm:inline-flex font-normal bg-primary/10 text-primary hover:bg-primary/15 border-transparent">
                {node.source}
              </Badge>
            )}
            {virt && <Badge variant="secondary" className="font-normal bg-primary/10 text-primary hover:bg-primary/15 border-transparent">{virt}</Badge>}
            {tags.map(t => (
              <Badge key={t} variant="secondary" className="font-normal bg-primary/10 text-primary hover:bg-primary/15 border-transparent">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        
        {/* 上半部分：将资源圆环和趋势图表并排展示 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
          <Section title="资源" className="flex flex-col">
            <div className="flex flex-wrap justify-around gap-4 sm:gap-6 my-auto">
              <Ring label="CPU" value={u.cpu} sub={loadAvg ?? undefined} />
              <Ring
                label="内存"
                value={u.mem}
                sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined}
              />
              <Ring
                label="磁盘"
                value={u.disk}
                sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined}
              />
              {swap != null && (
                <Ring
                  label="Swap"
                  value={swap}
                  sub={`${bytes(d?.used_swap)} / ${bytes(d?.total_swap)}`}
                />
              )}
            </div>
          </Section>

          {history.length > 1 && (
            <Section title={`近 ${history.length * 2} 秒趋势`} className="flex flex-col">
              <div className="grid grid-cols-2 gap-4 my-auto">
                <Spark
                  data={history}
                  dataKey="cpu"
                  label="CPU %"
                  stroke="#3b82f6"
                  domain={[0, 100]}
                  format={pct}
                />
                <Spark
                  data={history}
                  dataKey="mem"
                  label="内存 %"
                  stroke="#10b981"
                  domain={[0, 100]}
                  format={pct}
                />
                <Spark
                  data={history}
                  dataKey="netIn"
                  label="下行"
                  stroke="#8b5cf6"
                  format={v => `${bytes(v)}/s`}
                />
                <Spark
                  data={history}
                  dataKey="netOut"
                  label="上行"
                  stroke="#f59e0b"
                  format={v => `${bytes(v)}/s`}
                />
              </div>
            </Section>
          )}
        </div>

        <Section title="网络延迟">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PING_RANGES.map(range => (
              <Button
                key={range.hours}
                type="button"
                size="sm"
                variant={pingRangeHours === range.hours ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setPingRangeHours(range.hours)}
              >
                {range.label}
              </Button>
            ))}
          </div>
          {pingData.series.some(s => s.points.length > 1) ? (
            <PingSpark data={pingData} rangeHours={pingRangeHours} />
          ) : (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              {pingLoading ? '加载中…' : pingError ? `加载失败：${pingError}` : '暂无 ping / tcp_ping 数据'}
            </div>
          )}
        </Section>

        {/* 底部信息面板：三列布局的密集数据看板 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          <Section title="系统与内核" className="h-full">
            <KV k="主机名" v={s?.system_host_name} />
            <KV k="操作系统" v={osLabel(node)} />
            <KV k="内核" v={s?.system_kernel || s?.system_kernel_version} />
            <KV k="虚拟化" v={virt} />
            <KV k="进程数" v={d?.process_count} />
          </Section>

          <Section title="计算与存储" className="h-full">
            <KV k="CPU 架构" v={s?.arch || s?.cpu_arch} />
            <KV k="CPU 型号" v={cpu?.brand || cpu?.per_core?.[0]?.brand} />
            <KV
              k="核心"
              v={
                cpu?.physical_cores != null
                  ? `${cpu.physical_cores} 物理 / ${cpu.logical_cores} 逻辑`
                  : cpu?.per_core?.length
                    ? `${cpu.per_core.length} 核`
                    : null
              }
            />
            <KV k="磁盘读" v={d?.read_speed != null ? `${bytes(d.read_speed)}/s` : null} />
            <KV k="磁盘写" v={d?.write_speed != null ? `${bytes(d.write_speed)}/s` : null} />
          </Section>

          <Section title="网络与运行态" className="h-full">
            <KV k="系统负载" v={loadAvg} />
            <KV k="累计流量" v={
              d?.total_received != null && d?.total_transmitted != null 
                ? `↓ ${bytes(d.total_received)} / ↑ ${bytes(d.total_transmitted)}` 
                : null
            } />
            <KV
              k="TCP / UDP"
              v={
                d?.tcp_connections != null || d?.udp_connections != null
                  ? `${d?.tcp_connections ?? '—'} / ${d?.udp_connections ?? '—'}`
                  : null
              }
            />
            <KV k="运行时长" v={uptime(d?.uptime)} />
            <KV k="数据更新" v={relativeAge(d?.timestamp)} />
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-5 transition-all duration-300 hover:shadow-md hover:border-primary/20 hover:-translate-y-0.5 group ${className}`}>
      <div className="text-xs uppercase tracking-widest text-muted-foreground/70 mb-4 font-semibold group-hover:text-primary/70 transition-colors">{title}</div>
      {children}
    </Card>
  )
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  const displayV = v == null || v === '' ? '—' : v;
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-2 border-b border-border/40 last:border-0 hover:bg-muted/30 px-2 -mx-2 rounded transition-colors group h-10">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className="font-mono text-right truncate bg-secondary/40 group-hover:bg-secondary/60 px-1.5 py-0.5 rounded text-[13px] transition-colors max-w-[200px]">{displayV}</span>
    </div>
  )
}

function Ring({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  const hasValue = Number.isFinite(value)

  return (
    <div className="flex flex-col items-center gap-3 min-w-0 group cursor-default">
      <div className="relative w-24 h-24 sm:w-28 sm:h-28 transition-transform duration-300 group-hover:scale-105">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 drop-shadow-sm">
          <circle
            cx="50" cy="50" r={r}
            fill="none" strokeWidth={5}
            className="stroke-secondary/60 transition-colors duration-300 group-hover:stroke-secondary"
          />
          {hasValue && (
            <circle
              cx="50" cy="50" r={r}
              fill="none" strokeWidth={5}
              className={strokeColor(value)}
              strokeDasharray={c}
              strokeDashoffset={c - (c * v) / 100}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight">{pct(value)}</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-sm font-medium tracking-wide text-foreground/80 group-hover:text-foreground transition-colors">{label}</div>
        {sub && (
          <div className="text-[11px] font-mono text-muted-foreground/70 truncate max-w-[120px] px-2" title={sub}>
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

function PingSpark({ data, rangeHours }: { data: PingChartData; rangeHours: PingRangeHours }) {
  const { series } = data
  const now = Date.now()
  const from = now - rangeHours * 60 * 60 * 1000
  const bucketMs = rangeHours <= 6 ? 60_000 : rangeHours <= 24 ? 5 * 60_000 : 15 * 60_000
  const endBucket = from + Math.floor((now - from) / bucketMs) * bucketMs
  const valueBuckets = new Map<string, Map<number, number>>()

  for (const s of series) {
    const buckets = new Map<number, number>()
    for (const p of s.points) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.value)) continue
      if (p.t < from || p.t > now) continue
      const bucket = from + Math.floor((p.t - from) / bucketMs) * bucketMs
      buckets.set(bucket, p.value)
    }
    valueBuckets.set(s.key, buckets)
  }

  type PingAlignedPoint = { t: number; [key: string]: number | null }
  const alignedData: PingAlignedPoint[] = []
  const lastValues = new Map<string, number>()

  for (let t = from; t <= endBucket; t += bucketMs) {
    const row: PingAlignedPoint = { t }
    for (const s of series) {
      const val = valueBuckets.get(s.key)?.get(t)
      if (val != null) {
        lastValues.set(s.key, val)
        row[s.key] = val
      } else {
        row[s.key] = lastValues.get(s.key) ?? null
      }
    }
    alignedData.push(row)
  }
  const formatTime = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      month: rangeHours >= 24 ? '2-digit' : undefined,
      day: rangeHours >= 24 ? '2-digit' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    })
  const latest = new Map(
    series.map(s => [
      s.key,
      s.points.at(-1)?.value ?? null,
    ]),
  )
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex justify-between gap-3 text-[11px]">
          <span className="text-muted-foreground">网络延迟</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {series.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1 min-w-0">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="truncate max-w-[220px]" title={s.label}>{s.label}</span>
              <span className="font-mono text-muted-foreground">{ms(latest.get(s.key))}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={alignedData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis
              type="number"
              dataKey="t"
              domain={[from, now]}
              scale="time"
              tickFormatter={formatTime}
              minTickGap={24}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => formatTime(Number(t))}
              formatter={(v: number, name: string) => [
                ms(v),
                series.find(s => s.key === name)?.label ?? name,
              ]}
            />
            {series.map(s => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={true}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface SparkProps {
  data: HistorySample[]
  dataKey: keyof HistorySample
  label: string
  stroke: string
  domain?: [number, number]
  format: (v: number) => string
}

function Spark({ data, dataKey, label, stroke, domain, format }: SparkProps) {
  const last = Number(data.at(-1)?.[dataKey] ?? 0)
  const id = `g-${dataKey}`
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{format(last)}</span>
      </div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={domain ?? ['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t).toLocaleTimeString()}
              formatter={(v: number) => [format(v), label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={stroke}
              strokeWidth={1.5}
              fill={`url(#${id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
