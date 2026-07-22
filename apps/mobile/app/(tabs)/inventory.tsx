import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, useColorScheme, View } from 'react-native';
import { ulid } from '../../src/lib/ulid';
import { OfflineQueue } from '../../src/lib/offline-queue';
import { SqliteStore } from '../../src/lib/sqlite-store';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';
import type { OperationResult, QueueStatus } from '@techpioasset/domain';

/**
 * Offline physical inventory (spec section 16).
 *
 * Scans are captured into the offline queue and applied locally to the on-screen
 * count immediately, so a warehouse with no signal still works. When connectivity
 * returns, `flush` uploads the batch; the server's idempotent replay means a
 * retry after a dropped connection never double-counts. The sync-status line
 * shows pending / synced / conflicts clearly, as the spec requires.
 */
const queue = new OfflineQueue(new SqliteStore());

export default function InventoryScreen() {
  const { api } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [permission, requestPermission] = useCameraPermissions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const lastCode = useRef<string>('');

  const refreshPending = useCallback(async () => {
    setPending(await queue.pendingCount());
  }, []);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  async function startSession() {
    const session = await api.request<{ id: string }>('/mobile/inventory/sessions', {
      method: 'POST',
      body: { name: `Stocktake ${new Date().toLocaleDateString()}` },
    });
    setSessionId(session.id);
    setScanning(true);
  }

  async function onScanned(code: string) {
    if (code === lastCode.current) return;
    lastCode.current = code;
    setTimeout(() => {
      lastCode.current = '';
    }, 1200);

    await queue.enqueue({
      clientGeneratedId: ulid(),
      type: 'INVENTORY_SCAN',
      entityId: null,
      payload: { scannedCode: code },
      capturedAt: new Date().toISOString(),
    });
    await refreshPending();
  }

  async function sync() {
    if (!sessionId) return;
    const result = await queue.flush(
      (operations, sid) =>
        api.request<{ results: OperationResult[] }>('/mobile/sync', {
          method: 'POST',
          body: { sessionId: sid, operations },
        }),
      sessionId,
    );
    setStatus(result);
    await refreshPending();
    if (result.conflict > 0 || result.rejected > 0) {
      Alert.alert(
        'Sync finished with issues',
        `${result.conflict} conflict(s), ${result.rejected} rejected.`,
      );
    }
  }

  if (!permission?.granted) {
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}
      >
        <Text style={{ color: c.text, marginBottom: 16 }}>
          Camera access is needed to scan stock.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Grant camera access
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {scanning && sessionId ? (
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
          onBarcodeScanned={({ data }) => void onScanned(data)}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: c.text, fontSize: 16, marginBottom: 16, textAlign: 'center' }}>
            Start a stocktake, then scan items. Scans are saved even with no signal.
          </Text>
          <Pressable
            onPress={startSession}
            style={{ backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
          >
            <Text style={{ color: c.brandText, fontWeight: '600' }}>Start stocktake</Text>
          </Pressable>
        </View>
      )}

      <View
        style={{
          padding: 16,
          borderTopWidth: 1,
          borderTopColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Text style={{ color: c.text }}>
          {pending} scan(s) pending
          {status ? ` · ${status.applied} synced · ${status.conflict} conflict(s)` : ''}
        </Text>
        <Pressable
          onPress={sync}
          disabled={pending === 0}
          style={{
            marginTop: 10,
            backgroundColor: pending === 0 ? c.border : c.brand,
            borderRadius: 10,
            padding: 12,
          }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Sync now
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
