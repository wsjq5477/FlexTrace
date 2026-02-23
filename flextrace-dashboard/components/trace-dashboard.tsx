"use client";

import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  ChevronRight,
  Clock,
  Download,
  Filter,
  Monitor,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Tag,
  Target,
  User,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SectionKey = "overview" | "operations" | "intelligence" | "systems";

type TaskView = {
  taskId: string;
  sessionId: string;
  rootSessionId: string;
  parentTaskId?: string;
  name: string;
  kind?: string;
  agent?: string;
  activity: string;
  status: "ok" | "error" | "unknown" | "running";
  startTs: number;
  endTs: number;
  durationMs: number;
  attrs?: Record<string, unknown>;
};

type TracepointView = {
  type: "tracepoint";
  ts: number;
  tpId: string;
  name: string;
  sessionId: string;
  rootSessionId: string;
  level?: "info" | "warn" | "error";
  parentTaskId?: string;
  attrs?: Record<string, unknown>;
};

type CounterView = {
  type: "counter";
  ts: number;
  name: string;
  value: number;
  sessionId: string;
  rootSessionId: string;
};

type SessionNode = {
  sessionId: string;
  rootSessionId: string;
  parentSessionId?: string;
  title: string;
  children: string[];
};

type RootSessionView = {
  rootSessionId: string;
  title: string;
  sessionIds: string[];
};

type TimelineRow = {
  sessionId: string;
  agentName: string;
  label: string;
  spans: TaskView[];
};

type TimelineResponse = {
  ok: boolean;
  error?: string;
  tracePath: string;
  traceMode?: "single" | "multi";
  traceRoot?: string;
  projectFilter?: string;
  loadedSessions?: number;
  discoveredSessions?: number;
  sourceFiles?: string[];
  discoveredSourceFiles?: string[];
  sourceInfos?: Array<{
    path: string;
    loaded: boolean;
    excluded: boolean;
    mtimeMs: number;
    ageMs: number;
    status: "active" | "idle";
  }>;
  settings?: {
    rootDir?: string;
    maxProjectBytes?: number;
    captureUserMessages?: boolean;
    userMessagePreviewMax?: number;
  };
  excludedSourceFiles?: string[];
  generatedAt: number;
  latestTs: number;
  totalRecords: number;
  malformedLines: number;
  lagMs: number;
  staleThresholdMs: number;
  isStale: boolean;
  activeTasks: TaskView[];
  completedTasks: TaskView[];
  tracepoints: TracepointView[];
  counters: CounterView[];
  sessions: SessionNode[];
  roots: RootSessionView[];
  byAgentActivity: Array<{
    agent: string;
    activity: string;
    count: number;
    totalMs: number;
    avgMs: number;
    errors: number;
  }>;
};

const LIVE_WINDOW_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: 10_000, label: "10s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "1min" },
  { value: 300_000, label: "5min" },
  { value: 600_000, label: "10min" },
  { value: 1_800_000, label: "30min" },
  { value: 3_600_000, label: "60min" },
  { value: null, label: "No Limit" },
];

const NAV_ITEMS: Array<{ id: SectionKey; icon: ComponentType<{ className?: string }>; label: string }> = [
  { id: "overview", icon: Activity, label: "TIMELINE" },
  { id: "operations", icon: Server, label: "SESSION LIST" },
  { id: "intelligence", icon: Shield, label: "EVENTS" },
  { id: "systems", icon: Settings, label: "SETTINGS" },
];

export function TraceDashboard() {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tracePathInput, setTracePathInput] = useState("");
  const [traceRootInput, setTraceRootInput] = useState("~/.flextrace");
  const [maxSizeGBInput, setMaxSizeGBInput] = useState("1");
  const [settingNotice, setSettingNotice] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskView | null>(null);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const [selectedRootSession, setSelectedRootSession] = useState("all");
  const { isDark, toggleTheme } = useTheme();

  const lastPathRef = useRef("");
  const traceRootRef = useRef("~/.flextrace");
  const excludedSourcesRef = useRef<string[]>([]);
  const maxSizeInitializedRef = useRef(false);
  const [data, setData] = useState<TimelineResponse | null>(null);

  const fetchTimeline = async (pathText?: string, explicitExcluded?: string[]) => {
    const queryPath = typeof pathText === "string" ? pathText.trim() : lastPathRef.current;
    const queryRoot = traceRootRef.current.trim();
    const search = new URLSearchParams();
    if (queryPath) search.set("path", queryPath);
    if (!queryPath && queryRoot) search.set("root", queryRoot);
    for (const source of explicitExcluded ?? excludedSourcesRef.current) search.append("exclude", source);
    const query = search.toString();
    const response = await fetch(`/api/timeline${query ? `?${query}` : ""}`, { cache: "no-store" });
    const payload = (await response.json()) as TimelineResponse;
    if (!payload.ok) throw new Error(payload.error ?? "Failed to read timeline");
    lastPathRef.current = queryPath;
    setData(payload);
    const nextExcluded = payload.excludedSourceFiles ?? (explicitExcluded ?? excludedSourcesRef.current);
    excludedSourcesRef.current = nextExcluded;
    setExcludedSources(nextExcluded);
    setError(null);
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        if (!alive) return;
        await fetchTimeline();
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const loadTracePath = async () => {
    setLoading(true);
    try {
      await fetchTimeline(tracePathInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const useDefaultPath = async () => {
    setTracePathInput("");
    setLoading(true);
    try {
      await fetchTimeline("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const applyTraceRoot = async () => {
    const next = traceRootInput.trim() || "~/.flextrace";
    traceRootRef.current = next;
    setLoading(true);
    try {
      await fetchTimeline("");
      setSettingNotice(`Directory applied: ${next}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSettingNotice("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const bytes = data?.settings?.maxProjectBytes;
    if (maxSizeInitializedRef.current) return;
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
      setMaxSizeGBInput((bytes / 1024 ** 3).toFixed(2).replace(/\.00$/, ""));
      maxSizeInitializedRef.current = true;
    }
  }, [data?.settings?.maxProjectBytes]);

  const manualRefresh = async () => {
    setLoading(true);
    try {
      await fetchTimeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportChromeTrace = async () => {
    const path = lastPathRef.current;
    const search = new URLSearchParams();
    if (path) search.set("path", path);
    if (!path && traceRootRef.current.trim()) search.set("root", traceRootRef.current.trim());
    for (const source of excludedSources) search.append("exclude", source);
    const query = search.toString();
    const response = await fetch(`/api/trace${query ? `?${query}` : ""}`, { cache: "no-store" });
    const payload = (await response.json()) as { ok: boolean; records?: unknown[]; error?: string };
    if (!payload.ok || !payload.records) throw new Error(payload.error ?? "Cannot export trace");

    const blob = new Blob([JSON.stringify({ traceEvents: toChromeEvents(payload.records as Array<Record<string, unknown>>) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trace.chrome.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSourcePerfetto = async (sourcePath: string) => {
    const search = new URLSearchParams();
    search.set("path", sourcePath);
    const response = await fetch(`/api/trace?${search.toString()}`, { cache: "no-store" });
    const payload = (await response.json()) as { ok: boolean; records?: unknown[]; error?: string };
    if (!payload.ok || !payload.records) throw new Error(payload.error ?? "Cannot export source trace");
    const base = sourcePath.split("/").pop()?.replace(/\.ndjson$/i, "") || "trace";
    const blob = new Blob([JSON.stringify({ traceEvents: toChromeEvents(payload.records as Array<Record<string, unknown>>) }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.chrome.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSourceLoaded = async (sourcePath: string) => {
    const nextExcluded = excludedSources.includes(sourcePath)
      ? excludedSources.filter((v) => v !== sourcePath)
      : [...excludedSources, sourcePath];
    setLoading(true);
    try {
      await fetchTimeline(undefined, nextExcluded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const deleteSourceFile = async (sourcePath: string) => {
    const ok = window.confirm(`Delete trace file?\n${sourcePath}`);
    if (!ok) return;
    setLoading(true);
    try {
      const response = await fetch("/api/source", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sourcePath }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!payload.ok) throw new Error(payload.error ?? "Delete failed");
      const nextExcluded = excludedSources.filter((v) => v !== sourcePath);
      await fetchTimeline(undefined, nextExcluded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const titleText = NAV_ITEMS.find((item) => item.id === activeSection)?.label ?? "TIMELINE";

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className={`${sidebarCollapsed ? "w-16" : "w-72"} fixed z-50 h-full border-r border-neutral-700 bg-neutral-900 transition-all duration-300 md:relative`}
      >
        <div className="p-4">
          <div className="mb-8 flex items-center justify-between">
            {!sidebarCollapsed ? (
              <div>
                <h1 className="text-lg font-bold tracking-wider text-primary">FlexTrace</h1>
                <p className="text-xs text-neutral-500">v0.0.1 DashBoard</p>
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="text-neutral-400 hover:text-primary"
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <ChevronRight className={`h-5 w-5 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
            </Button>
          </div>

          <nav className="space-y-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center gap-3 rounded p-3 transition-colors ${
                  activeSection === item.id
                    ? "bg-primary text-white"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {!sidebarCollapsed ? <span className="text-sm font-medium">{item.label}</span> : null}
              </button>
            ))}
          </nav>

          {!sidebarCollapsed ? (
            <div className="mt-8 rounded border border-neutral-700 bg-neutral-800 p-4 text-xs">
              <div className="mb-2 flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${data?.isStale ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`}></div>
                <span className="text-white">{data?.isStale ? "CAPTURE IDLE" : "CAPTURE ACTIVE"}</span>
              </div>
              <div className="space-y-1 text-neutral-500">
                <div>RECORDS: {data?.totalRecords ?? "-"}</div>
                <div>ACTIVE TASKS: {data?.activeTasks.length ?? "-"}</div>
                <div>SESSIONS: {data?.loadedSessions ?? "-"}</div>
                <div>LAG: {formatLagHm(data?.lagMs)}</div>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      {!sidebarCollapsed ? <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarCollapsed(true)} /> : null}

      <div className="flex flex-1 flex-col md:ml-0">
        <header className="flex h-16 items-center justify-between border-b border-neutral-700 bg-neutral-800 px-4 md:px-6">
          <div className="text-sm text-neutral-400">
            FLEXTRACE / <span className="text-primary">{titleText}</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden text-xs text-neutral-500 md:block">LAST UPDATE: {formatDate(data?.generatedAt)}</div>
            <Button variant="ghost" size="icon" className="text-neutral-400 hover:text-primary" onClick={toggleTheme}>
              <span suppressHydrationWarning>{isDark ? "☀" : "◐"}</span>
            </Button>
            <Button variant="ghost" size="icon" className="text-neutral-400 hover:text-primary">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-neutral-400 hover:text-primary" onClick={() => void manualRefresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <GlobalContextBar data={data} selectedRootSession={selectedRootSession} />
          {error ? (
            <Card className="mb-4 border-red-700 bg-red-950/30">
              <CardHeader>
                <CardTitle className="text-red-300">Timeline Error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm text-red-200">{error}</p>
              </CardContent>
            </Card>
          ) : null}

          {activeSection === "overview" ? (
            <div className="space-y-6">
              <TopMetricsRow data={data} />
              <AgentsSection
                data={data}
                loading={loading}
                selectedTask={selectedTask}
                isDark={isDark}
                selectedRootSession={selectedRootSession}
                onSelectedRootSessionChange={setSelectedRootSession}
                onTaskClick={(span) => setSelectedTask(span)}
                onViewRaw={() => setActiveSection("intelligence")}
              />
              <OverviewSection data={data} loading={loading} />
            </div>
          ) : null}
          {activeSection === "operations" ? <OperationsSection data={data} /> : null}
          {activeSection === "intelligence" ? (
            <IntelligenceSection data={data} searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
          ) : null}
          {activeSection === "systems" ? (
            <SystemsSection
              data={data}
              tracePath={data?.tracePath ?? "-"}
              traceRootInput={traceRootInput}
              setTraceRootInput={setTraceRootInput}
              maxSizeGBInput={maxSizeGBInput}
              setMaxSizeGBInput={setMaxSizeGBInput}
              onApplyRoot={applyTraceRoot}
              onRefresh={manualRefresh}
              onToggleSourceLoaded={toggleSourceLoaded}
              onDeleteSourceFile={deleteSourceFile}
              onExportSourceFile={exportSourcePerfetto}
              excludedSources={excludedSources}
              settingNotice={settingNotice}
            />
          ) : null}
        </main>
      </div>

    </div>
  );
}

function TopActions({
  tracePath,
  tracePathInput,
  setTracePathInput,
  onLoad,
  onUseDefault,
  onExport,
  onFilter,
}: {
  tracePath: string;
  tracePathInput: string;
  setTracePathInput: (value: string) => void;
  onLoad: () => void;
  onUseDefault: () => void;
  onExport: () => void;
  onFilter: () => void;
}) {
  return (
    <Card className="mb-6 border-neutral-700 bg-neutral-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">TRACE CONTROL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="relative grow">
            <Search className="pointer-events-none absolute top-2.5 left-2 h-4 w-4 text-neutral-500" />
            <Input
              className="border-neutral-600 bg-neutral-800 pl-8 text-white placeholder:text-neutral-500"
              placeholder="/absolute/path/to/trace.ndjson"
              value={tracePathInput}
              onChange={(e) => setTracePathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onLoad();
              }}
            />
          </div>
          <Button className="bg-primary text-white hover:bg-primary/90" onClick={onLoad}>
            Load Trace
          </Button>
          <Button
            variant="outline"
            className="border-neutral-700 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            onClick={onUseDefault}
          >
            Use Default
          </Button>
          <Button
            variant="outline"
            className="border-neutral-700 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            onClick={onExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Perfetto
          </Button>
          <Button className="bg-primary text-white hover:bg-primary/90" onClick={onFilter}>
            <Filter className="mr-2 h-4 w-4" />
            Filter Activity
          </Button>
        </div>
        <div className="text-xs text-neutral-500">
          SOURCE: <span className="font-mono text-neutral-300">{tracePath}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewSection({ data, loading }: { data: TimelineResponse | null; loading: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="border-neutral-700 bg-neutral-900 lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">ACTIVITY ALLOCATION</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.byAgentActivity ?? []).slice(0, 8).map((row) => (
                <div key={`${row.agent}-${row.activity}`} className="rounded bg-neutral-800 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-white">{row.agent}</span>
                    {renderActivity(row.activity)}
                  </div>
                  <div className="mt-1 text-neutral-500">count={row.count} total={formatMs(row.totalMs)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-neutral-700 bg-neutral-900 lg:col-span-8">
          <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">RECENT COMPLETED TASKS</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <div className="py-8 text-sm text-neutral-500">Loading...</div> : null}
            <div className="space-y-2">
              {(data?.completedTasks ?? []).slice(0, 10).map((span) => (
                <div key={`${span.taskId}-${span.endTs}`} className="rounded border border-neutral-700 p-2 text-xs hover:bg-neutral-800">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{span.name}</span>
                    <span className="font-mono text-primary">{formatMs(span.durationMs)}</span>
                  </div>
                  <div className="mt-1 text-neutral-500">
                    {span.agent ?? "unknown-agent"} / {span.activity} / {span.status}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TopMetricsRow({ data }: { data: TimelineResponse | null }) {
  const totalOpenCodeSessions = data?.roots?.length ?? 0;
  const runningRootSessions = new Set((data?.activeTasks ?? []).map((task) => task.rootSessionId)).size;
  const activeAgents = new Set(
    (data?.activeTasks ?? [])
      .map((task) => (task.agent ?? "").trim())
      .filter((agent) => agent && agent !== "unknown-agent"),
  ).size;
  const isIdle = Boolean(data?.isStale);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <MetricCard label="OPENCODE SESSIONS" value={totalOpenCodeSessions} />
      <MetricCard label="RUNNING OPENCODE" value={runningRootSessions} />
      <MetricCard label="ACTIVE AGENTS" value={activeAgents} />
      <MetricCard label="RUNNING TASKS" value={data?.activeTasks.length ?? 0} />
      <MetricCard
        label="STATE"
        value={isIdle ? "IDLE" : "ACTIVE"}
        valueClassName={isIdle ? "text-amber-300" : "text-emerald-300"}
        icon={<span className={`h-2.5 w-2.5 rounded-full ${isIdle ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />}
      />
    </div>
  );
}

function GlobalContextBar({
  data,
  selectedRootSession,
}: {
  data: TimelineResponse | null;
  selectedRootSession: string;
}) {
  const rootLabel =
    selectedRootSession === "all"
      ? "All"
      : data?.roots?.find((r) => r.rootSessionId === selectedRootSession)?.title ?? shortenSessionId(selectedRootSession);
  return (
    <Card className="mb-4 border-neutral-700 bg-neutral-900">
      <CardContent className="flex flex-wrap items-center gap-2 p-3 text-xs">
        <Badge className="bg-neutral-800 text-neutral-200">DIR: {data?.traceRoot ?? "~/.flextrace"}</Badge>
        <Badge className="bg-neutral-800 text-neutral-200">ROOT: {rootLabel}</Badge>
        <Badge className="bg-neutral-800 text-neutral-200">LATEST: {formatDate(data?.latestTs)}</Badge>
        <Badge className={data?.isStale ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}>
          {data?.isStale ? "IDLE" : "ACTIVE"} · lag {formatLagHm(data?.lagMs)}
        </Badge>
      </CardContent>
    </Card>
  );
}

function AgentsSection({
  data,
  loading,
  selectedTask,
  isDark,
  selectedRootSession,
  onSelectedRootSessionChange,
  onTaskClick,
  onViewRaw,
}: {
  data: TimelineResponse | null;
  loading: boolean;
  selectedTask: TaskView | null;
  isDark: boolean;
  selectedRootSession: string;
  onSelectedRootSessionChange: (value: string) => void;
  onTaskClick: (task: TaskView | null) => void;
  onViewRaw: () => void;
}) {
  const rootEntries = useMemo(() => data?.roots ?? [], [data?.roots]);
  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionNode>();
    for (const node of data?.sessions ?? []) map.set(node.sessionId, node);
    return map;
  }, [data?.sessions]);
  const effectiveRoot =
    selectedRootSession === "all" || rootEntries.some((entry) => entry.rootSessionId === selectedRootSession)
      ? selectedRootSession
      : "all";

  const scopedCompletedTasks = useMemo(() => {
    if (!data) return [] as TaskView[];
    if (effectiveRoot === "all") return data.completedTasks;
    return data.completedTasks.filter((task) => task.rootSessionId === effectiveRoot);
  }, [data, effectiveRoot]);

  const scopedActiveTasks = useMemo(() => {
    if (!data) return [] as TaskView[];
    if (effectiveRoot === "all") return data.activeTasks;
    return data.activeTasks.filter((task) => task.rootSessionId === effectiveRoot);
  }, [data, effectiveRoot]);

  const scopedTracepoints = useMemo(() => {
    if (!data) return [] as TracepointView[];
    if (effectiveRoot === "all") return data.tracepoints;
    return data.tracepoints.filter((event) => event.rootSessionId === effectiveRoot);
  }, [data, effectiveRoot]);

  const scopedUserMessages = useMemo(
    () => scopedTracepoints.filter((event) => event.name === "user.message"),
    [scopedTracepoints],
  );

  const displayActiveTasks = useMemo(() => {
    if (!data) return [] as TaskView[];
    return scopedActiveTasks;
  }, [data, scopedActiveTasks]);

  const fallbackTs = useMemo(() => {
    const fromTasks = [...scopedCompletedTasks, ...displayActiveTasks].reduce((max, task) => Math.max(max, task.endTs), 0);
    const fromEvents = scopedTracepoints.reduce((max, event) => Math.max(max, event.ts), 0);
    return Math.max(fromTasks, fromEvents, data?.latestTs ?? 0);
  }, [data?.latestTs, displayActiveTasks, scopedCompletedTasks, scopedTracepoints]);

  const laneModel = useMemo(() => {
    const spans = [...scopedCompletedTasks, ...displayActiveTasks];
    if (spans.length === 0) {
      return {
        minTs: Math.max(0, fallbackTs - 1000),
        maxTs: fallbackTs,
        rows: [] as TimelineRow[],
      };
    }
    const minTs = spans.reduce((min, s) => Math.min(min, s.startTs), Number.POSITIVE_INFINITY);
    const maxTs = spans.reduce((max, s) => Math.max(max, s.endTs), 0);
    const map = new Map<string, TaskView[]>();
    for (const span of spans) {
      if (!map.has(span.sessionId)) map.set(span.sessionId, []);
      map.get(span.sessionId)?.push(span);
    }
    const rows = [...map.entries()].map(([sessionId, laneSpans]) => {
      const sortedSpans = laneSpans.sort((a, b) => a.startTs - b.startTs);
      const agentCounter = new Map<string, number>();
      for (const span of sortedSpans) {
        const agent = (span.agent ?? "").trim();
        if (!agent || agent === "unknown-agent") continue;
        agentCounter.set(agent, (agentCounter.get(agent) ?? 0) + 1);
      }
      const agentName =
        [...agentCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        sortedSpans.find((s) => s.agent && s.agent !== "unknown-agent")?.agent ??
        "unknown-agent";
      return {
        sessionId,
        agentName,
        label: sessionMap.get(sessionId)?.title ?? shortenSessionId(sessionId),
        spans: sortedSpans,
      };
    });
    rows.sort((a, b) => {
      if (effectiveRoot !== "all") {
        if (a.sessionId === effectiveRoot && b.sessionId !== effectiveRoot) return -1;
        if (b.sessionId === effectiveRoot && a.sessionId !== effectiveRoot) return 1;
      } else {
        const aNode = sessionMap.get(a.sessionId);
        const bNode = sessionMap.get(b.sessionId);
        const aIsRoot = aNode ? aNode.sessionId === aNode.rootSessionId : false;
        const bIsRoot = bNode ? bNode.sessionId === bNode.rootSessionId : false;
        if (aIsRoot && !bIsRoot) return -1;
        if (bIsRoot && !aIsRoot) return 1;
      }
      const aStart = a.spans[0]?.startTs ?? 0;
      const bStart = b.spans[0]?.startTs ?? 0;
      if (aStart !== bStart) return aStart - bStart;
      return a.label.localeCompare(b.label);
    });
    return { minTs, maxTs, rows };
  }, [displayActiveTasks, effectiveRoot, fallbackTs, scopedCompletedTasks, sessionMap]);

  const [windowStart, setWindowStart] = useState(() => laneModel.minTs);
  const [windowEnd, setWindowEnd] = useState(() => laneModel.maxTs);
  const [hoveredTask, setHoveredTask] = useState<TaskView | null>(null);
  const [liveFollow, setLiveFollow] = useState(true);
  const [liveWindowMs, setLiveWindowMs] = useState<number | null>(600_000);
  const [collapsedRows, setCollapsedRows] = useState(false);

  const effectiveWindow = useMemo(() => {
    if (liveFollow) {
      const end = laneModel.maxTs;
      if (liveWindowMs === null) return { start: laneModel.minTs, end: Math.max(laneModel.minTs + 1, end) };
      const windowMs = Math.max(1_000, liveWindowMs);
      const start = Math.max(laneModel.minTs, end - windowMs);
      return { start, end: Math.max(start + 1, end) };
    }
    const maxStart = Math.max(laneModel.minTs, laneModel.maxTs - 1);
    const start = Math.min(Math.max(windowStart, laneModel.minTs), maxStart);
    const end = Math.max(start + 1, Math.min(windowEnd, laneModel.maxTs));
    return { start, end };
  }, [laneModel.maxTs, laneModel.minTs, liveFollow, liveWindowMs, windowEnd, windowStart]);

  return (
    <div className="space-y-6">
      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">RUNNING TASKS</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-neutral-700">
                <TableHead>AGENT</TableHead>
                <TableHead>ACTIVITY</TableHead>
                <TableHead>NAME</TableHead>
                <TableHead className="text-right">DURATION</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayActiveTasks.slice(0, 20).map((span) => (
                <TableRow
                  key={span.taskId}
                  className="cursor-pointer border-neutral-800 hover:bg-neutral-800"
                  onClick={() => onTaskClick(span)}
                >
                  <TableCell className="font-mono text-xs">{span.agent ?? "-"}</TableCell>
                  <TableCell>{renderActivity(span.activity)}</TableCell>
                  <TableCell className="max-w-[400px] truncate">{span.name}</TableCell>
                  <TableCell className="text-right font-mono">{formatMs(span.durationMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">AGENT TIMELINE</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-neutral-500">
            latest={formatDate(data?.latestTs)} | lag={formatMs(data?.lagMs)} | malformed={data?.malformedLines ?? 0} | keys:
            W/S zoom, A/D pan | SYNC to follow right edge
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span>Root Session</span>
            <select
              className="h-7 rounded border border-neutral-700 bg-transparent px-2 text-xs text-neutral-200 outline-none"
              value={effectiveRoot}
              onChange={(e) => {
                onSelectedRootSessionChange(e.target.value);
                onTaskClick(null);
              }}
            >
              <option value="all" className="bg-neutral-900">
                All Root Sessions
              </option>
              {rootEntries.map((root) => (
                <option key={root.rootSessionId} value={root.rootSessionId} className="bg-neutral-900">
                  {root.title} ({shortenSessionId(root.rootSessionId)})
                </option>
              ))}
            </select>
            <span className="text-neutral-500">
              {effectiveRoot === "all" ? `total ${rootEntries.length}` : "filtered"}
            </span>
          </div>
          {effectiveRoot !== "all" ? (
            <div className="rounded border border-neutral-800 bg-neutral-950/50 p-2 text-xs text-neutral-400">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Session Tree</div>
              <ul className="space-y-1">
                {buildSessionTreeLines(effectiveRoot, sessionMap).length === 0 ? (
                  <li className="text-neutral-500">No child sessions</li>
                ) : (
                  buildSessionTreeLines(effectiveRoot, sessionMap).map((line) => (
                    <li key={line.key} className="font-mono">
                      {line.text}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
          <Separator className="bg-neutral-700" />
          {loading ? <div className="py-6 text-sm text-neutral-500">Loading timeline...</div> : null}
          {!loading ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <InteractiveTimeline
                  rows={laneModel.rows}
                  sessions={data?.sessions ?? []}
                  globalMinTs={laneModel.minTs}
                  globalMaxTs={laneModel.maxTs}
                  windowStart={effectiveWindow.start}
                  windowEnd={effectiveWindow.end}
                  stale={Boolean(data?.isStale)}
                  isDark={isDark}
                  tracepoints={scopedTracepoints}
                  userMessages={scopedUserMessages}
                  selectedTask={selectedTask}
                  liveFollow={liveFollow}
                  liveWindowMs={liveWindowMs}
                  collapsedRows={collapsedRows}
                  onWindowChange={(start, end) => {
                    if (liveFollow) setLiveFollow(false);
                    setWindowStart(start);
                    setWindowEnd(end);
                  }}
                  onToggleLiveFollow={() => setLiveFollow((v) => !v)}
                  onToggleCollapse={() => setCollapsedRows((v) => !v)}
                  onChangeLiveWindow={(next) => setLiveWindowMs(next)}
                  onHoverTask={setHoveredTask}
                  onSelectTask={onTaskClick}
                />
              </div>
              <div className="xl:col-span-1">
                <TaskDetailPanel
                  task={selectedTask ?? hoveredTask}
                  onClearSelection={() => onTaskClick(null)}
                  onViewRaw={onViewRaw}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OperationsSection({ data }: { data: TimelineResponse | null }) {
  const sessions = useMemo(() => {
    const grouped = new Map<string, TaskView[]>();
    for (const task of [...(data?.completedTasks ?? []), ...(data?.activeTasks ?? [])]) {
      if (!grouped.has(task.sessionId)) grouped.set(task.sessionId, []);
      grouped.get(task.sessionId)?.push(task);
    }
    return [...grouped.entries()]
      .map(([sessionId, tasks]) => {
        const totalMs = tasks.reduce((sum, s) => sum + s.durationMs, 0);
        const running = tasks.some((s) => s.status === "running");
        const errors = tasks.filter((s) => s.status === "error").length;
        return {
          sessionId,
          tasks,
          totalMs,
          running,
          errors,
          progress: running ? 65 : 100,
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 12);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-wider text-white">SESSION LIST</h2>
          <p className="text-sm text-neutral-400">Session execution overview and progress tracking</p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-primary text-white hover:bg-primary/90">New Operation</Button>
          <Button className="bg-primary text-white hover:bg-primary/90">Mission Brief</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((item) => (
          <Card key={item.sessionId} className="border-neutral-700 bg-neutral-900 hover:border-primary/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold tracking-wider text-white">SESSION OPERATION</CardTitle>
              <p className="truncate text-xs font-mono text-neutral-400">{item.sessionId}</p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-2">
                <Badge className={item.running ? "bg-primary/20 text-primary" : "bg-white/20 text-white"}>
                  {item.running ? "ACTIVE" : "COMPLETED"}
                </Badge>
                <Badge className={item.errors > 0 ? "bg-red-500/20 text-red-500" : "bg-white/20 text-white"}>
                  ERRORS {item.errors}
                </Badge>
              </div>
              <div className="text-neutral-400">tasks: {item.tasks.length}</div>
              <div className="text-neutral-400">total duration: {formatMs(item.totalMs)}</div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-neutral-400">Progress</span>
                  <span className="font-mono text-white">{item.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-800">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${item.progress}%` }}></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function IntelligenceSection({
  data,
  searchTerm,
  setSearchTerm,
}: {
  data: TimelineResponse | null;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
}) {
  const [quickFilter, setQuickFilter] = useState<"all" | "user" | "error" | "tool" | "counter">("all");
  const events = useMemo(() => {
    const userMessages = (data?.tracepoints ?? [])
      .filter((t) => t.name === "user.message")
      .map((t) => ({
        id: `user-${t.tpId}`,
        type: "user" as const,
        group: "user" as const,
        title: "user.message",
        ts: t.ts,
        sessionId: t.sessionId,
        summary: String((t.attrs as Record<string, unknown> | undefined)?.preview ?? ""),
        severity: "low" as const,
      }));
    const tracepoints = (data?.tracepoints ?? []).map((t) => ({
      id: t.tpId,
      type: "tracepoint" as const,
      group: t.level === "error" ? ("error" as const) : t.name.includes("tool") ? ("tool" as const) : ("all" as const),
      title: t.name,
      ts: t.ts,
      sessionId: t.sessionId,
      summary: JSON.stringify(t.attrs ?? {}),
      severity: "high" as const,
    }));
    const counters = (data?.counters ?? []).map((c, idx) => ({
      id: `${c.name}-${idx}-${c.ts}`,
      type: "counter" as const,
      group: "counter" as const,
      title: c.name,
      ts: c.ts,
      sessionId: c.sessionId ?? "-",
      summary: `value=${c.value}`,
      severity: "medium" as const,
    }));
    return [...userMessages, ...tracepoints, ...counters]
      .filter((e) => {
        if (quickFilter === "all") return true;
        if (quickFilter === "user") return e.group === "user";
        if (quickFilter === "counter") return e.group === "counter";
        if (quickFilter === "error") return e.group === "error";
        if (quickFilter === "tool") return e.group === "tool";
        return true;
      })
      .filter((e) => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return `${e.title} ${e.sessionId} ${e.summary}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 60);
  }, [data, quickFilter, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-wider text-white">EVENTS</h2>
          <p className="text-sm text-neutral-400">Events, counters, and user message timeline</p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-primary text-white hover:bg-primary/90">New Report</Button>
          <Button className="bg-primary text-white hover:bg-primary/90">
            <Filter className="mr-2 h-4 w-4" />
            Filter
          </Button>
        </div>
      </div>

      <Card className="border-neutral-700 bg-neutral-900">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["user", "User Message"],
                ["error", "Error"],
                ["tool", "Tool"],
                ["counter", "Counter"],
              ] as const).map(([key, label]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  className={`h-7 border-neutral-700 bg-transparent px-2 text-xs ${quickFilter === key ? "text-primary" : "text-neutral-300"}`}
                  onClick={() => setQuickFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-neutral-400" />
              <Input
                className="border-neutral-600 bg-neutral-800 pl-10 text-white placeholder:text-neutral-500"
                placeholder="Search events/counters/user messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">SIGNAL FEED</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="cursor-pointer rounded border border-neutral-700 p-3 hover:border-primary/50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-bold tracking-wider text-white">{event.title}</div>
                  <div className="text-xs font-mono text-neutral-500">session={event.sessionId}</div>
                  <div className="text-xs text-neutral-400">{event.summary}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={event.type === "tracepoint" ? "bg-primary/20 text-primary" : "bg-white/20 text-white"}>
                    {event.type.toUpperCase()}
                  </Badge>
                  <Badge className={event.severity === "high" ? "bg-red-500/20 text-red-500" : event.severity === "medium" ? "bg-neutral-500/20 text-neutral-300" : "bg-amber-500/20 text-amber-300"}>
                    {event.severity.toUpperCase()}
                  </Badge>
                  <Badge className="bg-white/20 text-white">{new Date(event.ts).toLocaleTimeString()}</Badge>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SystemsSection({
  data,
  tracePath,
  traceRootInput,
  setTraceRootInput,
  maxSizeGBInput,
  setMaxSizeGBInput,
  onApplyRoot,
  onRefresh,
  onToggleSourceLoaded,
  onDeleteSourceFile,
  onExportSourceFile,
  excludedSources,
  settingNotice,
}: {
  data: TimelineResponse | null;
  tracePath: string;
  traceRootInput: string;
  setTraceRootInput: (value: string) => void;
  maxSizeGBInput: string;
  setMaxSizeGBInput: (value: string) => void;
  onApplyRoot: () => void;
  onRefresh: () => void;
  onToggleSourceLoaded: (sourcePath: string) => void;
  onDeleteSourceFile: (sourcePath: string) => void;
  onExportSourceFile: (sourcePath: string) => void;
  excludedSources: string[];
  settingNotice: string;
}) {
  const sourceTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const root of data?.roots ?? []) {
      map.set(root.rootSessionId, root.title);
    }
    return map;
  }, [data?.roots]);

  return (
    <div className="space-y-6">
      {settingNotice ? (
        <Card className="border-emerald-700/50 bg-emerald-950/20">
          <CardContent className="p-3 text-xs text-emerald-300">{settingNotice}</CardContent>
        </Card>
      ) : null}
      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-wider text-neutral-300">
            TRACE DIRECTORY
            <Badge className="bg-emerald-500/20 text-emerald-300">LIVE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-neutral-500">Directory (default: ~/.flextrace)</div>
            <Input
              className="border-neutral-600 bg-neutral-800 text-white placeholder:text-neutral-500"
              value={traceRootInput}
              onChange={(e) => setTraceRootInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onApplyRoot();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button className="bg-primary text-white hover:bg-primary/90" onClick={() => void onApplyRoot()}>
              Apply
            </Button>
            <Button
              variant="outline"
              className="border-neutral-700 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
              onClick={() => void onRefresh()}
            >
              Refresh
            </Button>
          </div>
          <div className="text-xs text-neutral-500">
            current: <span className="font-mono text-neutral-300">{data?.traceRoot ?? tracePath}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-wider text-neutral-300">
            LOG RETENTION
            <Badge className="bg-amber-500/20 text-amber-300">RESTART REQUIRED</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-neutral-500">Max project log size (GB)</div>
            <Input
              className="border-neutral-600 bg-neutral-800 text-white placeholder:text-neutral-500"
              value={maxSizeGBInput}
              onChange={(e) => setMaxSizeGBInput(e.target.value)}
            />
          </div>
          <div className="text-xs text-neutral-500">
            default `1G`, enforced in plugin config as `maxProjectBytes`. When exceeded, oldest `.ndjson` files are deleted.
          </div>
          <div className="text-xs text-neutral-500">
            current detected:{" "}
            <span className="font-mono text-neutral-300">
              {typeof data?.settings?.maxProjectBytes === "number"
                ? `${(data.settings.maxProjectBytes / 1024 ** 3).toFixed(2)} GB`
                : "unknown"}
            </span>
          </div>
          <div className="text-xs text-amber-300">
            This dashboard cannot hot-update plugin runtime config. Update plugin config and restart OpenCode to apply.
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-neutral-700 bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
              onClick={() =>
                navigator.clipboard.writeText(
                  `createFlexTracePlugin({ maxProjectBytes: ${Math.max(1, Math.round((Number(maxSizeGBInput) || 1) * 1024 ** 3))} })`,
                )
              }
            >
              Copy Config Snippet
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-neutral-700 bg-neutral-900">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-wider text-neutral-300">LOADED TRACE SOURCES</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-xs text-neutral-500">
            loaded={(data?.sourceFiles ?? []).length} / discovered={data?.discoveredSessions ?? data?.loadedSessions ?? 0}
          </div>
          {(data?.sourceInfos ?? []).length === 0 ? (
            <div className="rounded border border-neutral-800 bg-neutral-950/50 p-3 text-xs text-neutral-500">No trace sources found.</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-700 bg-transparent px-2 text-xs"
                  onClick={() => {
                    const idle = (data?.sourceInfos ?? []).filter((s) => s.status === "idle" && !s.excluded);
                    idle.forEach((s) => onToggleSourceLoaded(s.path));
                  }}
                >
                  Exclude All Idle
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-neutral-700 bg-transparent px-2 text-xs"
                  onClick={() => {
                    const excluded = (data?.sourceInfos ?? []).filter((s) => s.excluded);
                    excluded.forEach((s) => onToggleSourceLoaded(s.path));
                  }}
                >
                  Load All Excluded
                </Button>
              </div>
              {(data?.sourceInfos ?? []).map((info) => {
                const source = info.path;
                const excluded = excludedSources.includes(source);
                const file = source.split("/").pop() ?? source;
                const rootId = file.endsWith(".ndjson") ? file.slice(0, -".ndjson".length) : file;
                const title = sourceTitleMap.get(rootId) ?? "-";
                return (
                  <div key={source} className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950/50 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-neutral-300">{source}</div>
                      <div className="truncate text-[10px] text-neutral-400">title: {title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px]">
                        <Badge className={excluded ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}>
                          {excluded ? "EXCLUDED" : "LOADED"}
                        </Badge>
                        <Badge className={info.status === "active" ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-500/20 text-zinc-300"}>
                          {info.status.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        updated {formatAge(info.ageMs)} ago
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-neutral-700 bg-transparent px-2 text-xs"
                      onClick={() => onToggleSourceLoaded(source)}
                    >
                      {excluded ? "Load" : "Exclude"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-neutral-700 bg-transparent px-2 text-xs"
                      onClick={() => void onExportSourceFile(source)}
                    >
                      Export Perfetto
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-red-700 bg-transparent px-2 text-xs text-red-300 hover:bg-red-900/30"
                      onClick={() => onDeleteSourceFile(source)}
                    >
                      Delete
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function InteractiveTimeline({
  rows,
  sessions,
  globalMinTs,
  globalMaxTs,
  windowStart,
  windowEnd,
  stale,
  isDark,
  tracepoints,
  userMessages,
  selectedTask,
  liveFollow,
  liveWindowMs,
  collapsedRows,
  onWindowChange,
  onToggleLiveFollow,
  onToggleCollapse,
  onChangeLiveWindow,
  onHoverTask,
  onSelectTask,
}: {
  rows: TimelineRow[];
  sessions: SessionNode[];
  globalMinTs: number;
  globalMaxTs: number;
  windowStart: number;
  windowEnd: number;
  stale: boolean;
  isDark: boolean;
  tracepoints: TracepointView[];
  userMessages: TracepointView[];
  selectedTask: TaskView | null;
  liveFollow: boolean;
  liveWindowMs: number | null;
  collapsedRows: boolean;
  onWindowChange: (start: number, end: number) => void;
  onToggleLiveFollow: () => void;
  onToggleCollapse: () => void;
  onChangeLiveWindow: (windowMs: number | null) => void;
  onHoverTask: (task: TaskView | null) => void;
  onSelectTask: (task: TaskView) => void;
}) {
  const laneLabelWidth = 180;
  const topAxisHeight = 56;
  const headerHeight = 34;
  const userTrackHeight = 30;
  const laneHeight = 28;
  const laneGap = 6;
  const rowPadding = 10;
  const sessionEventHeight = 22;
  const sessionEventGap = 8;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startStart: number; startEnd: number } | null>(null);
  const [hoverTaskInfo, setHoverTaskInfo] = useState<{ task: TaskView; x: number; y: number } | null>(null);
  const [hoverEventInfo, setHoverEventInfo] = useState<{ event: TracepointView; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1200);

  const totalWindowMs = Math.max(1, windowEnd - windowStart);
  const globalRangeMs = Math.max(1, globalMaxTs - globalMinTs);

  const applyWindow = useCallback((nextStart: number, nextEnd: number) => {
    const minWindowMs = Math.max(1, globalRangeMs / 500);
    let s = nextStart;
    let e = nextEnd;
    if (e - s < minWindowMs) e = s + minWindowMs;
    if (s < globalMinTs) {
      const delta = globalMinTs - s;
      s += delta;
      e += delta;
    }
    if (e > globalMaxTs) {
      const delta = e - globalMaxTs;
      s -= delta;
      e -= delta;
    }
    if (s < globalMinTs) s = globalMinTs;
    if (e > globalMaxTs) e = globalMaxTs;
    if (e - s < minWindowMs) e = s + minWindowMs;
    onWindowChange(s, e);
  }, [globalMaxTs, globalMinTs, globalRangeMs, onWindowChange]);

  const panByRatio = useCallback(
    (ratio: number) => {
      const shift = totalWindowMs * ratio;
      applyWindow(windowStart + shift, windowEnd + shift);
    },
    [applyWindow, totalWindowMs, windowEnd, windowStart]
  );

  const zoomByRatio = useCallback(
    (factor: number) => {
      const center = (windowStart + windowEnd) / 2;
      const nextWindow = Math.max(1, totalWindowMs * factor);
      applyWindow(center - nextWindow / 2, center + nextWindow / 2);
    },
    [applyWindow, totalWindowMs, windowEnd, windowStart]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        zoomByRatio(0.8);
      } else if (key === "s") {
        event.preventDefault();
        zoomByRatio(1.25);
      } else if (key === "a") {
        event.preventDefault();
        panByRatio(-0.12);
      } else if (key === "d") {
        event.preventDefault();
        panByRatio(0.12);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panByRatio, zoomByRatio]);

  useEffect(() => {
    if (!containerRef.current) return;
    const update = () => {
      if (!containerRef.current) return;
      const width = Math.max(320, containerRef.current.clientWidth - laneLabelWidth - 8);
      setViewportWidth(width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(containerRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const packedRows = useMemo(() => {
    return rows.map((row) => {
      const sorted = [...row.spans].sort((a, b) => a.startTs - b.startTs);
      const lanes: TaskView[][] = [];
      const laneLastEnd: number[] = [];

      for (const span of sorted) {
        let targetLane = -1;
        for (let i = 0; i < laneLastEnd.length; i += 1) {
          if (laneLastEnd[i] <= span.startTs) {
            targetLane = i;
            break;
          }
        }
        if (targetLane === -1) {
          targetLane = lanes.length;
          lanes.push([]);
          laneLastEnd.push(-Infinity);
        }
        lanes[targetLane].push(span);
        laneLastEnd[targetLane] = Math.max(laneLastEnd[targetLane], span.endTs);
      }

      return {
        sessionId: row.sessionId,
        agentName: row.agentName,
        label: row.label,
        lanes: lanes.length > 0 ? lanes : [[]],
      };
    });
  }, [rows]);

  const rowLayouts = useMemo(() => {
    return packedRows.reduce<
      Array<{ sessionId: string; agentName: string; label: string; lanes: TaskView[][]; y: number; height: number; laneCount: number }>
    >((acc, row) => {
      const visibleLanes = collapsedRows ? row.lanes.slice(0, 1) : row.lanes;
      const laneCount = Math.max(1, visibleLanes.length);
      const height =
        rowPadding * 2 +
        sessionEventHeight +
        sessionEventGap +
        laneCount * laneHeight +
        (laneCount - 1) * laneGap;
      const y = acc.length > 0 ? acc[acc.length - 1].y + acc[acc.length - 1].height : 0;
      acc.push({
        sessionId: row.sessionId,
        agentName: row.agentName,
        label: row.label,
        lanes: visibleLanes,
        y,
        height,
        laneCount,
      });
      return acc;
    }, []);
  }, [collapsedRows, laneGap, laneHeight, packedRows, rowPadding, sessionEventGap, sessionEventHeight]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (event.clientX - rect.left < laneLabelWidth) return;
    dragRef.current = {
      startX: event.clientX,
      startStart: windowStart,
      startEnd: windowEnd,
    };
    setIsDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const timelineWidth = Math.max(1, rect.width - laneLabelWidth - 8);

    if (dragRef.current) {
      const deltaPx = event.clientX - dragRef.current.startX;
      const deltaMs = (deltaPx / timelineWidth) * totalWindowMs;
      applyWindow(dragRef.current.startStart - deltaMs, dragRef.current.startEnd - deltaMs);
      return;
    }

    const x = event.clientX - rect.left - laneLabelWidth;
    const y = event.clientY - rect.top - topAxisHeight - headerHeight - userTrackHeight;
    if (y < 0 || x < 0) {
      setHoverTaskInfo(null);
      onHoverTask(null);
      return;
    }

    const ts = windowStart + (x / timelineWidth) * totalWindowMs;
    const row = rowLayouts.find((layout) => y >= layout.y && y <= layout.y + layout.height);
    if (!row) {
      setHoverTaskInfo(null);
      onHoverTask(null);
      return;
    }
    const laneY = y - row.y - rowPadding - sessionEventHeight - sessionEventGap;
    const laneStep = laneHeight + laneGap;
    const laneIndex = Math.floor(laneY / laneStep);
    if (laneIndex < 0 || laneIndex >= row.lanes.length) {
      setHoverTaskInfo(null);
      onHoverTask(null);
      return;
    }
    if (laneY % laneStep > laneHeight) {
      setHoverTaskInfo(null);
      onHoverTask(null);
      return;
    }

    const hit = row.lanes[laneIndex].find((task) => task.startTs <= ts && task.endTs >= ts);
    if (hit) {
      const tipWidth = 290;
      const tipHeight = 88;
      const margin = 8;
      const rawX = event.clientX - rect.left + margin;
      const rawY = event.clientY - rect.top + margin;
      const maxX = Math.max(margin, rect.width - tipWidth - margin);
      const maxY = Math.max(margin, rect.height - tipHeight - margin);
      const clampedX = Math.min(Math.max(margin, rawX), maxX);
      const clampedY = Math.min(Math.max(margin, rawY), maxY);
      setHoverTaskInfo({ task: hit, x: clampedX, y: clampedY });
      setHoverEventInfo(null);
      onHoverTask(hit);
    } else {
      setHoverTaskInfo(null);
      onHoverTask(null);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  const tickStepMs = pickTickStepMs(totalWindowMs, viewportWidth);
  const tickValues = useMemo(() => {
    const first = Math.ceil(windowStart / tickStepMs) * tickStepMs;
    const values: number[] = [];
    for (let t = first; t <= windowEnd; t += tickStepMs) values.push(t);
    return values;
  }, [tickStepMs, windowEnd, windowStart]);

  const taskIndex = useMemo(() => {
    const index = new Map<string, { task: TaskView; sessionId: string; laneIndex: number }>();
    for (const row of rowLayouts) {
      row.lanes.forEach((lane, laneIndex) => {
        lane.forEach((task) => index.set(task.taskId, { task, sessionId: row.sessionId, laneIndex }));
      });
    }
    return index;
  }, [rowLayouts]);

  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);

  const handoffLinks = useMemo(() => {
    const rowBySession = new Map(rowLayouts.map((row) => [row.sessionId, row] as const));
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session] as const));
    const taskPositions = new Map<string, { task: TaskView; xStart: number; xEnd: number; y: number; sessionId: string }>();
    const earliestAgentRunBySession = new Map<string, { task: TaskView; xStart: number; y: number }>();
    const tasksBySession = new Map<string, Array<{ task: TaskView; xStart: number; xEnd: number; y: number }>>();

    for (const row of rowLayouts) {
      row.lanes.forEach((lane, laneIndex) => {
        lane.forEach((task) => {
          const xStart = clampPercent(((Math.max(task.startTs, windowStart) - windowStart) / totalWindowMs) * 100);
          const xEnd = clampPercent(((Math.min(task.endTs, windowEnd) - windowStart) / totalWindowMs) * 100);
          const y = row.y + rowPadding + sessionEventHeight + sessionEventGap + laneIndex * (laneHeight + laneGap) + laneHeight / 2;
          taskPositions.set(task.taskId, { task, xStart, xEnd, y, sessionId: row.sessionId });
          if (!tasksBySession.has(row.sessionId)) tasksBySession.set(row.sessionId, []);
          tasksBySession.get(row.sessionId)?.push({ task, xStart, xEnd, y });
          if (task.name.startsWith("agent_run:")) {
            const prev = earliestAgentRunBySession.get(row.sessionId);
            if (!prev || task.startTs < prev.task.startTs) {
              earliestAgentRunBySession.set(row.sessionId, { task, xStart, y });
            }
          }
        });
      });
    }

    const links: Array<{
      id: string;
      x1Pct: number;
      y1: number;
      x2Pct: number;
      y2: number;
      parentTask: TaskView;
      childTask: TaskView;
    }> = [];
    for (const [childSessionId, target] of earliestAgentRunBySession.entries()) {
      if (!rowBySession.has(childSessionId)) continue;
      const childSession = sessionById.get(childSessionId);
      const parentSessionId = childSession?.parentSessionId;
      if (!parentSessionId) continue;
      if (!rowBySession.has(parentSessionId)) continue;
      const parentTasks = tasksBySession.get(parentSessionId) ?? [];
      if (parentTasks.length === 0) continue;

      // Prefer explicit dispatch-like tasks (`task` tool / activity:tool:task),
      // then fall back to nearest task in parent session by time.
      const dispatchCandidates = parentTasks.filter(({ task }) => {
        const tool = taskTool(task);
        return (
          tool === "task" ||
          task.name === "task" ||
          task.name.includes(":task") ||
          task.name.includes("subagent")
        );
      });
      const pool = dispatchCandidates.length > 0 ? dispatchCandidates : parentTasks;
      const source = pool
        .slice()
        .sort((a, b) => Math.abs(a.task.startTs - target.task.startTs) - Math.abs(b.task.startTs - target.task.startTs))[0];
      if (!source) continue;

      links.push({
        id: `${source.task.taskId}->${childSessionId}`,
        x1Pct: source.xStart,
        y1: source.y,
        x2Pct: target.xStart,
        y2: target.y,
        parentTask: source.task,
        childTask: target.task,
      });
    }
    return links;
  }, [
    sessions,
    laneGap,
    laneHeight,
    rowLayouts,
    rowPadding,
    sessionEventGap,
    sessionEventHeight,
    totalWindowMs,
    windowEnd,
    windowStart,
  ]);

  const selectedHandoff = useMemo(
    () => (selectedHandoffId ? handoffLinks.find((item) => item.id === selectedHandoffId) : undefined),
    [handoffLinks, selectedHandoffId],
  );

  const linkByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of handoffLinks) {
      map.set(link.parentTask.taskId, link.id);
      map.set(link.childTask.taskId, link.id);
    }
    return map;
  }, [handoffLinks]);

  const highlightedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedHandoff) {
      ids.add(selectedHandoff.parentTask.taskId);
      ids.add(selectedHandoff.childTask.taskId);
    }
    return ids;
  }, [selectedHandoff]);

  const visibleEvents = useMemo(
    () => tracepoints.filter((event) => event.ts >= windowStart && event.ts <= windowEnd),
    [tracepoints, windowEnd, windowStart],
  );
  const visibleUserMessages = useMemo(
    () => userMessages.filter((event) => event.ts >= windowStart && event.ts <= windowEnd),
    [userMessages, windowEnd, windowStart],
  );

  if (rows.length === 0 && visibleUserMessages.length === 0) return <div className="py-6 text-sm text-neutral-500">No tasks yet.</div>;

  const selectedInWindow =
    selectedTask && selectedTask.endTs >= windowStart && selectedTask.startTs <= windowEnd ? selectedTask : null;
  const selectedLeftPct = selectedInWindow
    ? ((Math.max(selectedInWindow.startTs, windowStart) - windowStart) / totalWindowMs) * 100
    : 0;
  const selectedWidthPct = selectedInWindow
    ? Math.max(
        0.2,
        ((Math.min(selectedInWindow.endTs, windowEnd) - Math.max(selectedInWindow.startTs, windowStart)) /
          totalWindowMs) *
          100
      )
    : 0;
  const taskRowsHeight = rowLayouts.reduce((acc, row) => acc + row.height, 0);
  const timelineHeight = topAxisHeight + headerHeight + userTrackHeight + taskRowsHeight;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          visible: {formatDate(windowStart)} - {formatDate(windowEnd)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className={`h-7 border-neutral-700 bg-transparent px-2 ${liveFollow ? "text-emerald-400" : "text-neutral-400"}`}
            onClick={onToggleLiveFollow}
          >
            <span className="mr-2">SYNC</span>
            <span
              className={`relative inline-flex h-4 w-8 items-center rounded-full border ${liveFollow ? "border-emerald-500/80 bg-emerald-500/20" : "border-neutral-600 bg-neutral-800"}`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full transition-all duration-200 ${liveFollow ? "translate-x-[18px] bg-emerald-400" : "translate-x-[2px] bg-neutral-400"}`}
              />
            </span>
          </Button>
          <select
            className="h-7 rounded border border-neutral-700 bg-transparent px-2 text-xs text-neutral-200 outline-none"
            value={liveWindowMs === null ? "none" : String(liveWindowMs)}
            onChange={(e) => onChangeLiveWindow(e.target.value === "none" ? null : Number(e.target.value))}
          >
            {LIVE_WINDOW_OPTIONS.map((item) => (
              <option key={item.label} value={item.value === null ? "none" : String(item.value)} className="bg-neutral-900">
                {`Window ${item.label}`}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-7 border-neutral-700 bg-transparent px-2" onClick={() => zoomByRatio(1.25)}>
            -
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-neutral-700 bg-transparent px-2"
            onClick={() => applyWindow(globalMinTs, globalMaxTs)}
          >
            Fit
          </Button>
          <Button variant="outline" size="sm" className="h-7 border-neutral-700 bg-transparent px-2" onClick={() => zoomByRatio(0.8)}>
            +
          </Button>
          <Button variant="outline" size="sm" className="h-7 border-neutral-700 bg-transparent px-2" onClick={onToggleCollapse}>
            {collapsedRows ? "Expand Rows" : "Collapse Rows"}
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded border border-neutral-700 bg-neutral-950 ${isDragging ? "cursor-grabbing" : "cursor-default"}`}
        style={{ height: timelineHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="absolute inset-x-0 top-0 grid grid-cols-[180px_1fr] border-b border-neutral-700">
          <div className="border-r border-neutral-700 bg-neutral-900 px-3 py-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Time Axis
          </div>
          <div className="relative h-7 px-2">
            {tickValues.map((ts) => {
              const pct = ((ts - windowStart) / totalWindowMs) * 100;
              return (
                <div key={`tick-axis-${ts}`} className="absolute inset-y-0 border-l border-neutral-700/70" style={{ left: `${pct}%` }}>
                  <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-neutral-500">
                    {formatTickLabel(ts, tickStepMs)}
                  </span>
                </div>
              );
            })}
            {selectedInWindow ? (
              <>
                <div
                  className={`absolute bottom-2 border-l ${isDark ? "border-neutral-100/85" : "border-black/75"}`}
                  style={{ left: `${selectedLeftPct}%`, top: 30 }}
                />
                <div
                  className={`absolute bottom-2 border-l ${isDark ? "border-neutral-100/85" : "border-black/75"}`}
                  style={{ left: `${Math.min(100, selectedLeftPct + selectedWidthPct)}%`, top: 30 }}
                />
                <span
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] ${isDark ? "text-neutral-100" : "text-black"}`}
                  style={{ top: 32, left: `${selectedLeftPct + selectedWidthPct / 2}%` }}
                >
                  {formatMs(selectedInWindow.durationMs)}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="absolute inset-x-0" style={{ top: topAxisHeight }}>
          <div className="grid grid-cols-[180px_1fr] border-b border-neutral-700 text-xs uppercase tracking-wide text-neutral-400">
            <div className="border-r border-neutral-700 bg-neutral-900 px-3 py-2">Session / Thread</div>
            <div className="h-7 px-2 py-2 text-[10px] text-neutral-500"></div>
          </div>
        </div>

        <div className="absolute inset-x-0" style={{ top: topAxisHeight + headerHeight }}>
          <div className="grid grid-cols-[180px_1fr] border-b border-neutral-800" style={{ minHeight: userTrackHeight }}>
            <div className="border-r border-neutral-700 bg-neutral-900 px-3 py-2">
              <div className="truncate font-mono text-xs text-white">USER</div>
              <div className="truncate text-[10px] text-neutral-400">Input messages</div>
            </div>
            <div className="relative overflow-hidden bg-[linear-gradient(to_right,rgba(64,64,64,0.35)_1px,transparent_1px)] bg-[size:12.5%_100%]">
              {visibleUserMessages.map((event) => {
                const left = clampPercent(((event.ts - windowStart) / totalWindowMs) * 100);
                const preview = asText((event.attrs as Record<string, unknown> | undefined)?.preview);
                return (
                  <button
                    key={`event-user-${event.tpId}`}
                    type="button"
                    className="absolute top-1 z-10 h-5 w-5 -translate-x-1/2"
                    style={{ left: `${left}%` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setHoverTaskInfo(null);
                      setHoverEventInfo({
                        event: { ...event, name: preview ? `user.message: ${preview}` : "user.message" },
                        x: Math.min(rect.width - 280, Math.max(8, e.clientX - rect.left + 8)),
                        y: Math.min(rect.height - 86, Math.max(8, e.clientY - rect.top + 8)),
                      });
                    }}
                    onMouseLeave={() => setHoverEventInfo(null)}
                  >
                    <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-amber-300" />
                    <span
                      className="absolute left-1/2 top-0.5 h-3 w-4 -translate-x-1/2"
                      style={{
                        clipPath: "polygon(0 0, 100% 25%, 0 100%)",
                        background: "#f59e0b",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0" style={{ top: topAxisHeight + headerHeight + userTrackHeight }}>
          {rowLayouts.map((row) => (
            <div key={row.sessionId} className="grid grid-cols-[180px_1fr] border-b border-neutral-800 last:border-none" style={{ minHeight: row.height }}>
              <div className="border-r border-neutral-700 bg-neutral-900 px-3 py-2">
                <div className="truncate font-mono text-xs text-white">{row.agentName}</div>
                <div className="truncate text-[10px] text-neutral-400">{row.label}</div>
                <div className="text-[10px] text-neutral-500">{row.laneCount} lane{row.laneCount > 1 ? "s" : ""}</div>
              </div>
              <div className="relative overflow-hidden bg-[linear-gradient(to_right,rgba(64,64,64,0.35)_1px,transparent_1px)] bg-[size:12.5%_100%]">
                <div className="absolute inset-x-0" style={{ top: rowPadding, height: sessionEventHeight }}>
                  <div className="relative h-full border border-neutral-800/80 bg-neutral-900/60">
                    {visibleEvents
                      .filter((event) => event.sessionId === row.sessionId)
                      .map((event) => {
                        const left = clampPercent(((event.ts - windowStart) / totalWindowMs) * 100);
                        return (
                          <button
                            key={`event-session-${row.sessionId}-${event.tpId}`}
                            type="button"
                            className="absolute top-1 z-10 h-4 w-4 -translate-x-1/2"
                            style={{ left: `${left}%` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseEnter={(e) => {
                              const rect = containerRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              setHoverTaskInfo(null);
                              setHoverEventInfo({
                                event,
                                x: Math.min(rect.width - 280, Math.max(8, e.clientX - rect.left + 8)),
                                y: Math.min(rect.height - 86, Math.max(8, e.clientY - rect.top + 8)),
                              });
                            }}
                            onMouseLeave={() => setHoverEventInfo(null)}
                            onClick={() => {
                              const parent = event.parentTaskId ? taskIndex.get(event.parentTaskId)?.task : undefined;
                              if (parent) onSelectTask(parent);
                            }}
                          >
                            <span className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-neutral-200" />
                            <span
                              className="absolute left-1/2 top-0.5 h-2.5 w-3.5 -translate-x-1/2"
                              style={{
                                clipPath: "polygon(0 0, 100% 20%, 0 100%)",
                                background: eventLevelColor(event.level),
                              }}
                            />
                          </button>
                        );
                      })}
                  </div>
                </div>
                {row.lanes.map((lane, laneIndex) => {
                  const y = rowPadding + sessionEventHeight + sessionEventGap + laneIndex * (laneHeight + laneGap);
                  return lane.map((task) => {
                    const left = ((Math.max(task.startTs, windowStart) - windowStart) / totalWindowMs) * 100;
                    const width = Math.max(
                      0.8,
                      ((Math.min(task.endTs, windowEnd) - Math.max(task.startTs, windowStart)) / totalWindowMs) * 100
                    );
                    const colorClass = activityClass(task.activity);
                    const statusClass =
                      task.status === "error"
                        ? "ring-1 ring-red-400/90"
                        : task.status === "running" && !stale
                          ? "ring-1 ring-primary/70"
                          : "ring-1 ring-neutral-500/40";
                    const selectedClass = selectedTask?.taskId === task.taskId ? "outline outline-2 outline-primary" : "";
                    const chainClass = highlightedTaskIds.has(task.taskId) ? "outline outline-2 outline-rose-400/85" : "";

                    return (
                      <button
                        key={`${row.sessionId}-${laneIndex}-${task.taskId}-${task.startTs}`}
                        className={`absolute rounded-[2px] px-2 text-left text-[11px] leading-6 text-white shadow-none ${colorClass} ${statusClass} ${selectedClass} ${chainClass}`}
                        style={{ top: y, left: `${left}%`, width: `${width}%`, height: laneHeight }}
                        onClick={() => {
                          setSelectedHandoffId(linkByTaskId.get(task.taskId) ?? null);
                          onSelectTask(task);
                        }}
                      >
                        <span className="inline-block max-w-full truncate align-top" style={{ color: "#fff" }}>
                          {taskTimelineLabel(task)} · {formatMs(task.durationMs)}
                        </span>
                      </button>
                    );
                  });
                })}
              </div>
            </div>
          ))}
        </div>

        {selectedHandoff ? (
          <svg
            className="pointer-events-none absolute"
            style={{ left: laneLabelWidth, top: topAxisHeight + headerHeight + userTrackHeight }}
            width={viewportWidth}
            height={taskRowsHeight}
          >
            <defs>
              <linearGradient id="handoff-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#fb7185" />
              </linearGradient>
              <filter id="handoff-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker id="handoff-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 1 1 L 11 6 L 1 11 Q 4 6 1 1" fill="#fb7185" />
              </marker>
            </defs>
            {(() => {
              const link = selectedHandoff;
              const x1 = (link.x1Pct / 100) * viewportWidth;
              const x2 = (link.x2Pct / 100) * viewportWidth;
              const c1x = x1 + Math.max(26, Math.abs(x2 - x1) * 0.22);
              const c2x = x2 - Math.max(26, Math.abs(x2 - x1) * 0.22);
              return (
                <g key={link.id}>
                  <path
                    d={`M ${x1} ${link.y1} C ${c1x} ${link.y1}, ${c2x} ${link.y2}, ${x2} ${link.y2}`}
                    stroke="#fb7185"
                    strokeOpacity={1}
                    strokeWidth={2.8}
                    fill="none"
                    markerEnd="url(#handoff-arrow)"
                    filter="url(#handoff-glow)"
                  />
                  <circle cx={x1} cy={link.y1} r={3.8} fill="#f59e0b" />
                </g>
              );
            })()}
          </svg>
        ) : null}

        {hoverTaskInfo ? (
          <div
            className="pointer-events-none absolute z-20 max-w-[280px] rounded border border-neutral-700 bg-neutral-900/95 p-2 text-xs text-neutral-100 shadow-lg"
            style={{ left: hoverTaskInfo.x, top: hoverTaskInfo.y }}
          >
            <div className="font-medium">{hoverTaskInfo.task.name}</div>
            <div className="mt-1 text-neutral-400">
              {hoverTaskInfo.task.agent ?? "unknown-agent"} / {hoverTaskInfo.task.activity}
            </div>
            {taskDoing(hoverTaskInfo.task) ? <div className="text-neutral-300">{taskDoing(hoverTaskInfo.task)}</div> : null}
            <div className="text-neutral-400">
              {hoverTaskInfo.task.status} · {formatMs(hoverTaskInfo.task.durationMs)}
            </div>
          </div>
        ) : null}

        {hoverEventInfo ? (
          <div
            className="pointer-events-none absolute z-20 max-w-[280px] rounded border border-neutral-700 bg-neutral-900/95 p-2 text-xs text-neutral-100 shadow-lg"
            style={{ left: hoverEventInfo.x, top: hoverEventInfo.y }}
          >
            <div className="font-medium">{hoverEventInfo.event.name}</div>
            <div className="mt-1 text-neutral-400">level={hoverEventInfo.event.level ?? "info"}</div>
            <div className="text-neutral-400">time={new Date(hoverEventInfo.event.ts).toLocaleTimeString()}</div>
            <div className="text-neutral-400">session={hoverEventInfo.event.sessionId}</div>
            <div className="text-neutral-400">parentTaskId={hoverEventInfo.event.parentTaskId ?? "-"}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onClearSelection,
  onViewRaw,
}: {
  task: TaskView | null;
  onClearSelection: () => void;
  onViewRaw: () => void;
}) {
  if (!task) {
    return (
      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="border-b border-border bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-wide text-foreground">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Task Detail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Hover or click a task on timeline to view details.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-border bg-card">
      <CardHeader className="border-b border-border bg-muted/30">
        <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-wide text-foreground">
          <Tag className="h-4 w-4 text-muted-foreground" />
          Task Detail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Name</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{task.name}</div>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{task.agent ?? "-"}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Activity</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium text-white ${activityClass(task.activity)}`}>{task.activity}</span>
          </div>
        </div>
        <div className="space-y-2">
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Status" value={task.status} />
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Duration" value={formatMs(task.durationMs)} />
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Session" value={task.sessionId} mono />
          {taskDoing(task) ? <DetailRow icon={<Tag className="h-4 w-4" />} label="Doing" value={taskDoing(task) ?? "-"} mono /> : null}
          {taskTool(task) ? <DetailRow icon={<Tag className="h-4 w-4" />} label="Tool" value={taskTool(task) ?? "-"} mono /> : null}
        </div>
        <div className="rounded-xl bg-muted/50 p-2 text-xs font-mono text-muted-foreground">taskId={task.taskId}</div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={onViewRaw}>
            View Raw Task
          </Button>
          <Button
            variant="outline"
            className="rounded-xl border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => navigator.clipboard.writeText(task.taskId)}
          >
            Copy TaskId
          </Button>
          <Button
            variant="outline"
            className="rounded-xl border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClearSelection}
          >
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`${mono ? "font-mono" : ""} text-sm text-foreground`}>{value}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="border-neutral-700 bg-neutral-900">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-wider text-neutral-400">{label}</p>
            <p className={`font-mono text-2xl font-bold ${valueClassName ?? "text-white"}`}>{value}</p>
          </div>
          {icon ?? null}
        </div>
      </CardContent>
    </Card>
  );
}

function renderActivity(activity: string) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${activityClass(activity)}`}>{activity}</span>;
}

function taskTimelineLabel(task: TaskView): string {
  const doing = taskDoing(task);
  if (!doing) return task.name;
  return `${task.name} · ${truncateHead(doing, 52)}`;
}

function taskDoing(task: TaskView): string | undefined {
  const attrs = task.attrs as Record<string, unknown> | undefined;
  return asText(attrs?.doing);
}

function taskTool(task: TaskView): string | undefined {
  const attrs = task.attrs as Record<string, unknown> | undefined;
  return asText(attrs?.toolName) ?? asText(attrs?.tool);
}

function activityClass(activity: string) {
  if (activity === "agent_run") return "bg-blue-500";
  if (activity === "reasoning") return "bg-amber-400";
  if (activity === "coding") return "bg-emerald-500";
  if (activity === "tool") return "bg-violet-500";
  return "bg-zinc-500";
}

function eventLevelColor(level?: "info" | "warn" | "error") {
  if (level === "error") return "#ef4444";
  if (level === "warn") return "#f59e0b";
  return "#38bdf8";
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function truncateHead(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function formatMs(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatDate(ts?: number) {
  if (typeof ts !== "number" || ts <= 0) return "-";
  return new Date(ts).toLocaleString();
}

function formatAge(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "-";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
}

function formatLagHm(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "-";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function toChromeEvents(records: Array<Record<string, unknown>>) {
  const byStart = new Map<string, { ts: number; sessionId: string; name: string; agent: string; activity: string; kind?: string }>();
  const mirroredToolCallIds = new Set<string>();
  const events: Array<Record<string, unknown>> = [];

  for (const rec of records) {
    if (rec.type === "task_start") {
      const attrs = rec.attrs as Record<string, unknown> | undefined;
      if (rec.kind === "manual" && String(rec.name ?? "").startsWith("activity:")) {
        const callID = attrs?.callID;
        if (typeof callID === "string" && callID) mirroredToolCallIds.add(callID);
      }
      byStart.set(String(rec.taskId), {
        ts: Number(rec.ts),
        sessionId: String(rec.sessionId ?? "-"),
        name: String(rec.name ?? "task"),
        agent: String(attrs?.agent ?? "unknown-agent"),
        activity: String(attrs?.activity ?? "unknown-activity"),
        kind: typeof rec.kind === "string" ? rec.kind : undefined,
      });
      continue;
    }
    if (rec.type !== "task_end") continue;
    const taskId = String(rec.taskId ?? "");
    const start = byStart.get(taskId);
    if (!start) continue;
    if (start.kind === "tool" && mirroredToolCallIds.has(taskId)) continue;
    const endTs = Number(rec.ts);
    const durUs = Math.max(1, Math.round((endTs - start.ts) * 1000));
    events.push({
      name: start.name,
      cat: start.activity,
      ph: "X",
      ts: Math.round(start.ts * 1000),
      dur: durUs,
      pid: 1,
      tid: start.agent,
      args: {
        taskId,
        sessionId: start.sessionId,
        status: String(rec.status ?? "unknown"),
      },
    });
  }
  return events;
}

function pickTickStepMs(windowMs: number, viewportWidth: number) {
  const minPixelGap = 120;
  const msPerPixel = Math.max(0.001, windowMs / Math.max(1, viewportWidth));
  const targetStep = msPerPixel * minPixelGap;
  const candidates = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000, 900000, 1800000, 3600000,
  ];
  for (const step of candidates) {
    if (step >= targetStep) return step;
  }
  return 3600000;
}

function formatTickLabel(ts: number, stepMs: number) {
  const d = new Date(ts);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  if (stepMs < 1000) return `${hh}:${mm}:${ss}.${pad(d.getMilliseconds(), 3)}`;
  if (stepMs < 60000) return `${hh}:${mm}:${ss}`;
  return `${hh}:${mm}`;
}

function shortenSessionId(sessionId: string) {
  if (!sessionId) return "-";
  if (sessionId.length <= 14) return sessionId;
  return `${sessionId.slice(0, 6)}...${sessionId.slice(-4)}`;
}

function buildSessionTreeLines(rootSessionId: string, sessionMap: Map<string, SessionNode>): Array<{ key: string; text: string }> {
  const root = sessionMap.get(rootSessionId);
  if (!root) return [];
  const lines: Array<{ key: string; text: string }> = [];
  const walk = (sessionId: string, depth: number) => {
    const node = sessionMap.get(sessionId);
    if (!node) return;
    for (const childId of node.children) {
      const child = sessionMap.get(childId);
      if (!child) continue;
      const prefix = `${"  ".repeat(depth)}└`;
      lines.push({
        key: `${child.sessionId}:${depth}`,
        text: `${prefix} ${child.title} (${shortenSessionId(child.sessionId)})`,
      });
      walk(child.sessionId, depth + 1);
    }
  };
  walk(root.sessionId, 0);
  return lines;
}

function clampPercent(value: number, min = 0.8, max = 99.2): number {
  return Math.min(max, Math.max(min, value));
}
