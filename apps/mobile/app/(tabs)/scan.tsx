import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { NativeOnlyNotice } from '../../src/components/native-only-notice';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';

/**
 * QR / barcode scanner (spec section 15).
 *
 * A scan resolves the code to the authorised asset record via the API's
 * /assets/by-qr endpoint, which enforces the same permission and scope rules as
 * every other read — so a scanned code leaks nothing, and an employee scanning
 * someone else's asset gets a not-found, exactly as the web enforces.
 */
export default function ScanScreen() {
  const { api } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // Guard so a single physical scan does not fire many lookups while the camera
  // keeps reporting the same code frame after frame.
  const handling = useRef(false);

  // The browser build (react-native-web, for laptop review) has no device
  // camera flow; show a notice rather than a webcam prompt.
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyNotice
        title="Scanning needs the device camera"
        message="QR and barcode scanning uses the phone camera, which isn't available when the app runs in a browser."
      />
    );
  }

  async function onScanned(code: string) {
    if (handling.current) return;
    handling.current = true;
    setError(null);
    try {
      const asset = await api.request<{ id: string }>(`/assets/by-qr/${encodeURIComponent(code)}`);
      router.push(`/asset/${asset.id}`);
    } catch {
      setError('That code does not match an asset you can access.');
      // Allow another attempt after a short delay.
      setTimeout(() => {
        handling.current = false;
      }, 1500);
    }
  }

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  if (!permission.granted) {
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}
      >
        <Text style={{ color: c.text, fontSize: 16, marginBottom: 16 }}>
          Camera access is needed to scan asset codes.
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
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'code39'] }}
        onBarcodeScanned={({ data }) => void onScanned(data)}
      />
      {error ? (
        <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20 }}>
          <Text
            style={{
              color: '#fff',
              backgroundColor: '#ef4444',
              padding: 12,
              borderRadius: 8,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
