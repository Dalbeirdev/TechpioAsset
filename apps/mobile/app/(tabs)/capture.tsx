import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { NativeOnlyNotice } from '../../src/components/native-only-notice';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';

interface UploadResult {
  invoice: { id: string; invoiceNumber: string; verificationStatus: string };
  extraction: { ran: boolean; simulated: boolean; reason?: string };
}

/**
 * Capture a bill with the camera and upload it (spec section 9).
 *
 * The phone camera is the natural place to capture a paper invoice. The photo is
 * uploaded to POST /invoices/upload, which validates it by signature, stores it
 * privately, and runs extraction only if AI is enabled for the company —
 * deterministic verification always follows. This screen only shows what the
 * server reports back; it never claims an extraction ran when it did not.
 */
export default function CaptureBillScreen() {
  const { api } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Capturing and uploading a photo is a device flow; the browser build (for
  // laptop review) has no camera, so show a notice rather than a webcam prompt.
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyNotice
        title="Capturing a bill needs a device"
        message="Photographing an invoice uses the phone camera, which isn't available when the app runs in a browser. Upload bills from the web app on a laptop instead."
      />
    );
  }

  if (!permission?.granted) {
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}
      >
        <Text style={{ color: c.text, fontSize: 16, marginBottom: 16 }}>
          Camera access is needed to photograph a bill.
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

  async function capture() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setResult(null);
      setError(null);
    }
  }

  async function upload() {
    if (!photoUri) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // React Native's FormData accepts a { uri, name, type } file descriptor.
      form.append('file', {
        uri: photoUri,
        name: `bill-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
      const uploaded = await api.request<UploadResult>('/invoices/upload', { formData: form });
      setResult(uploaded);
      setPhotoUri(null);
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhotoUri(null);
    setResult(null);
    setError(null);
  }

  // Result screen — what the server actually did with the bill.
  if (result) {
    const { invoice, extraction } = result;
    const extractionLine = !extraction.ran
      ? 'Saved for manual entry — AI extraction is off for your company.'
      : extraction.simulated
        ? 'A simulated extraction ran (demo mode). Review the draft on the web app.'
        : 'Fields were extracted from the photo. Review and confirm on the web app.';
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ padding: 24 }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Bill uploaded</Text>
          <Text style={{ color: c.muted, marginTop: 6 }}>Draft {invoice.invoiceNumber}</Text>
          <Text style={{ color: c.text, marginTop: 12, lineHeight: 20 }}>{extractionLine}</Text>
        </View>
        <Pressable
          onPress={reset}
          style={{ marginTop: 20, backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Capture another
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Preview + confirm screen.
  if (photoUri) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri: photoUri }} style={{ flex: 1 }} resizeMode="contain" />
        {error ? (
          <Text
            style={{
              color: '#fff',
              backgroundColor: '#ef4444',
              padding: 12,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            padding: 16,
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <Pressable
            onPress={reset}
            disabled={busy}
            style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14 }}
          >
            <Text style={{ color: c.text, textAlign: 'center', fontWeight: '600' }}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={upload}
            disabled={busy}
            style={{ flex: 1, backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
          >
            {busy ? (
              <ActivityIndicator color={c.brandText} />
            ) : (
              <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
                Upload
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // Camera screen with a shutter button.
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} />
      <View style={{ padding: 20, backgroundColor: c.surface, alignItems: 'center' }}>
        <Text style={{ color: c.muted, fontSize: 12, marginBottom: 12 }}>
          Frame the whole bill, then tap to capture.
        </Text>
        <Pressable
          onPress={capture}
          style={{
            width: 68,
            height: 68,
            borderRadius: 999,
            backgroundColor: c.brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{ width: 54, height: 54, borderRadius: 999, borderWidth: 3, borderColor: c.brandText }}
          />
        </Pressable>
      </View>
    </View>
  );
}
