'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { ReportedFreshness } from './reported-freshness';

/**
 * v2.5 H5 — the discovery-backed asset tabs (Hardware / OS & Security /
 * Software / Health). Every tab renders honestly when discovery has not seen
 * the machine yet: an empty state, never invented values.
 */

export interface HardwareProfileDto {
  manufacturer: string | null;
  modelName: string | null;
  cpu: string | null;
  cpuCores: number | null;
  ramGb: string | null;
  ramSlotsUsed: number | null;
  ramSlotsTotal: number | null;
  storageTotalGb: string | null;
  storageFreeGb: string | null;
  smartStatus: 'HEALTHY' | 'WARNING' | 'FAILING' | null;
  batteryHealthPct: number | null;
  batteryCycleCount: number | null;
  gpu: string | null;
  biosVersion: string | null;
  source: string;
  lastDiscoveredAt: string;
}

export interface OsInfoDto {
  osName: string | null;
  osVersion: string | null;
  osBuild: string | null;
  osSupported: boolean | null;
  osActivated: boolean | null;
  lastBootAt: string | null;
  diskEncrypted: boolean | null;
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  tpmPresent: boolean | null;
  localAdminCount: number | null;
  missingCriticalPatches: number | null;
  source: string;
  lastDiscoveredAt: string;
}

export interface HealthDto {
  overall: number;
  grade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  subScores: { key: string; score: number; weight: number }[];
  recommendations: string[];
  capped: boolean;
  computedAt: string;
}

const GRADE_TONE: Record<HealthDto['grade'], string> = {
  EXCELLENT: 'success',
  GOOD: 'success',
  FAIR: 'warning',
  POOR: 'critical',
  CRITICAL: 'critical',
};

const SMART_TONE: Record<NonNullable<HardwareProfileDto['smartStatus']>, string> = {
  HEALTHY: 'success',
  WARNING: 'warning',
  FAILING: 'critical',
};

export function Tone({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

const NOT_DISCOVERED = {
  title: 'Nothing discovered yet',
  description:
    'No agent or connector has reported this machine. Data appears here after a discovery run matches it.',
};

export function HardwareTab({ hw }: { hw: HardwareProfileDto | null }) {
  if (!hw) return <EmptyState {...NOT_DISCOVERED} />;
  const gb = (v: string | null) => (v != null ? `${Number(v).toLocaleString()} GB` : null);
  return (
    <Card className="p-5">
      {/* Ahead of the data, not under it: you should know how old a snapshot is
          before you start reading it as fact. */}
      <ReportedFreshness source={hw.source} at={hw.lastDiscoveredAt} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Row label="Manufacturer" value={hw.manufacturer} />
        <Row label="Model" value={hw.modelName} />
        <Row label="Processor" value={hw.cpu} />
        <Row label="Cores" value={hw.cpuCores} />
        <Row label="Memory" value={gb(hw.ramGb)} />
        <Row
          label="Memory slots"
          value={hw.ramSlotsTotal != null ? `${hw.ramSlotsUsed ?? '?'} of ${hw.ramSlotsTotal} used` : null}
        />
        <Row label="Storage" value={gb(hw.storageTotalGb)} />
        <Row label="Free space" value={gb(hw.storageFreeGb)} />
        <Row
          label="Drive (SMART)"
          value={hw.smartStatus ? <Tone tone={SMART_TONE[hw.smartStatus]}>{hw.smartStatus.toLowerCase()}</Tone> : null}
        />
        <Row
          label="Battery"
          value={hw.batteryHealthPct != null ? `${hw.batteryHealthPct}% health` : null}
        />
        <Row label="Battery cycles" value={hw.batteryCycleCount} />
        <Row label="Graphics" value={hw.gpu} />
        <Row label="BIOS" value={hw.biosVersion} />
      </dl>
    </Card>
  );
}

function PostureRow({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      {ok === null ? (
        <span className="text-xs text-[var(--color-content-subtle)]">not reported</span>
      ) : (
        <Tone tone={ok ? 'success' : 'critical'}>{detail ?? (ok ? 'on' : 'off')}</Tone>
      )}
    </div>
  );
}

export function OsTab({ os }: { os: OsInfoDto | null }) {
  if (!os) return <EmptyState {...NOT_DISCOVERED} />;
  return (
    <div className="grid gap-4">
      {/* Once for the whole tab: both cards below are the same snapshot, and
          repeating the warning would train people to ignore it. */}
      <ReportedFreshness source={os.source} at={os.lastDiscoveredAt} />
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Operating system</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Row label="OS" value={os.osName} />
          <Row label="Version" value={os.osVersion} />
          <Row label="Build" value={os.osBuild} />
          <Row
            label="Support"
            value={
              os.osSupported == null ? null : (
                <Tone tone={os.osSupported ? 'success' : 'critical'}>
                  {os.osSupported ? 'supported' : 'out of support'}
                </Tone>
              )
            }
          />
          <Row
            label="Activation"
            value={
              os.osActivated == null ? null : (
                <Tone tone={os.osActivated ? 'success' : 'warning'}>
                  {os.osActivated ? 'activated' : 'not activated'}
                </Tone>
              )
            }
          />
          <Row label="Last boot" value={os.lastBootAt ? new Date(os.lastBootAt).toLocaleString() : null} />
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Security posture</h2>
        <div className="mt-2 divide-y divide-[var(--color-border)]">
          <PostureRow label="Disk encryption" ok={os.diskEncrypted} />
          <PostureRow label="Antivirus" ok={os.defenderEnabled} />
          <PostureRow label="Firewall" ok={os.firewallEnabled} />
          <PostureRow label="TPM" ok={os.tpmPresent} detail={os.tpmPresent ? 'present' : 'missing'} />
          <PostureRow
            label="Local administrators"
            ok={os.localAdminCount == null ? null : os.localAdminCount <= 1}
            detail={os.localAdminCount != null ? `${os.localAdminCount}` : undefined}
          />
          <PostureRow
            label="Missing critical updates"
            ok={os.missingCriticalPatches == null ? null : os.missingCriticalPatches === 0}
            detail={os.missingCriticalPatches != null ? `${os.missingCriticalPatches}` : undefined}
          />
        </div>
      </Card>
    </div>
  );
}

interface SoftwareRow {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installedAt: string | null;
}

export function SoftwareTab({ assetId }: { assetId: string }) {
  const [page, setPage] = useState(1);
  const { data, isPending } = useQuery({
    queryKey: ['asset-software', assetId, page],
    queryFn: () => apiFetchPage<SoftwareRow>(`/assets/${assetId}/software?page=${page}&pageSize=25`),
  });

  if (isPending) return <Skeleton className="h-48" />;
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        title="No software inventory"
        description="Installed applications appear here once discovery reports this machine."
      />
    );
  }
  const { totalItems, totalPages } = data.meta.page as { totalItems: number; totalPages?: number };
  const pages = totalPages ?? Math.ceil(totalItems / 25);
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Installed software, {totalItems} in total</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left">
              <th scope="col" className="px-4 py-2.5 font-medium">Application</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Version</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Publisher</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.data.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2.5 font-medium">{row.name}</td>
                <td className="px-4 py-2.5 text-[var(--color-content-muted)]">{row.version ?? '—'}</td>
                <td className="px-4 py-2.5 text-[var(--color-content-muted)]">{row.publisher ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2.5 text-sm">
          <span className="text-[var(--color-content-subtle)]">
            Page {page} of {pages} · {totalItems} applications
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

const DIMENSION_LABELS: Record<string, string> = {
  battery: 'Battery',
  storage: 'Storage',
  memory: 'Memory',
  warranty: 'Warranty',
  security: 'Security',
  updates: 'Updates',
};

export function HealthTab({
  assetId,
  health,
  canRecompute,
}: {
  assetId: string;
  health: HealthDto | null;
  canRecompute: boolean;
}) {
  const queryClient = useQueryClient();
  const recompute = useMutation({
    mutationFn: () => apiFetch(`/assets/${assetId}/health/recompute`, { method: 'POST', body: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset', assetId] }),
  });

  if (!health) {
    return (
      <EmptyState
        title="No health score"
        description="Health is derived from discovered hardware and security posture. Nothing is known about this machine yet, so no score is shown — never a made-up one."
      />
    );
  }

  const tone = GRADE_TONE[health.grade];
  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-4xl font-bold tabular-nums" style={{ color: `var(--tone-${tone}-fg)` }}>
            {health.overall}
            <span className="text-base font-medium text-[var(--color-content-subtle)]"> / 100</span>
          </p>
          <Tone tone={tone}>{health.grade.toLowerCase()}</Tone>
          {canRecompute ? (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              loading={recompute.isPending}
              onClick={() => recompute.mutate()}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" /> Recompute
            </Button>
          ) : null}
        </div>
        {health.capped ? (
          <p
            className="mt-3 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            Capped at Poor: a safety-critical dimension (security or storage) scored badly, so the
            overall cannot read higher no matter how good the rest looks.
          </p>
        ) : null}
        <div className="mt-4 grid gap-2.5">
          {health.subScores.map((sub) => (
            <div key={sub.key} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="text-[var(--color-content-muted)]">
                {DIMENSION_LABELS[sub.key] ?? sub.key}
              </span>
              <div
                className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                role="img"
                aria-label={`${DIMENSION_LABELS[sub.key] ?? sub.key}: ${sub.score} out of 100`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${sub.score}%`,
                    backgroundColor:
                      sub.score >= 75
                        ? 'var(--tone-success-fg)'
                        : sub.score >= 40
                          ? 'var(--tone-warning-fg)'
                          : 'var(--tone-critical-fg)',
                  }}
                />
              </div>
              <span className="text-right tabular-nums">{sub.score}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-content-subtle)]">
          Computed {new Date(health.computedAt).toLocaleString()} · dimensions discovery knows
          nothing about are excluded, not guessed.
        </p>
      </Card>

      {health.recommendations.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Recommendations</h2>
          <ul className="mt-3 grid gap-2">
            {health.recommendations.map((rec) => (
              <li key={rec} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--tone-warning-fg)]" />
                {rec}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
