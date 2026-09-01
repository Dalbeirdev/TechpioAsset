import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { Button } from './ui';

/**
 * Photograph an asset's condition, on the phone (v2.33).
 *
 * This is where these photos actually get taken. The web can accept an upload,
 * but the equipment is in someone's hands at a desk, and the person holding it
 * has a camera in their pocket - so the sheet opens straight into the viewfinder
 * rather than a file picker.
 *
 * Built on expo-camera, which the app already ships. expo-image-picker would
 * have been a more obvious fit and is not worth a new native module here: this
 * monorepo's Expo autolinking is fragile enough that adding one means a full
 * prebuild, and the camera can already take a picture.
 *
 * Several photos usually belong to one inspection - lid, base, screen, the
 * charger that came with it - so the sheet stays open after each upload and
 * counts them, instead of making somebody reopen it four times.
 */

export type PhotoStage = 'HANDOVER' | 'RETURN';

export function ConditionPhotoSheet({
  visible,
  assetId,
  assetName,
  stage,
  onClose,
  onUploaded,
}: {
  visible: boolean;
  assetId: string;
  assetName: string;
  /** Which end of the custody event this is. The server files it accordingly. */
  stage: PhotoStage;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const title = stage === 'HANDOVER' ? 'Photo at handover' : 'Photo on return';

  function close() {
    setPending(null);
    setSaved(0);
    setError(null);
    onClose();
  }

  async function shoot() {
    setError(null);
    try {
      // Not full resolution: these are looked at on a phone and stored for
      // years, and a 12 MP original of a laptop lid proves nothing more than a
      // 2 MP one does.
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) setPending(photo.uri);
    } catch {
      setError('The camera could not take that picture. Try again.');
    }
  }

  async function upload() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // React Native's FormData takes a { uri, name, type } descriptor.
      form.append('file', {
        uri: pending,
        name: `condition-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
      form.append('stage', stage);

      await api.request(`/assets/${assetId}/photos`, { formData: form });
      setPending(null);
      setSaved((n) => n + 1);
      onUploaded();
    } catch (caught) {
      // The server's own words: it explains why a photo has nowhere to go
      // ("this asset is not currently assigned") far better than we can here.
      setError(caught instanceof Error ? caught.message : 'That photo could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '92%',
            paddingBottom: spacing.xl,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{title}</Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                {assetName}
                {saved > 0 ? ` · ${saved} saved` : ''}
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            {error ? (
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>
                {error}
              </Text>
            ) : null}

            {/*
              The app also runs in a browser via react-native-web for review on
              a laptop, and there is no phone camera there. Say so plainly and
              point at the web app, which accepts the same photos as an upload -
              rather than rendering a viewfinder that can never take a picture.
            */}
            {Platform.OS === 'web' ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <Ionicons name="phone-portrait-outline" size={34} color={c.muted} />
                <Text
                  style={{
                    color: c.muted,
                    fontSize: 13,
                    textAlign: 'center',
                    marginTop: spacing.md,
                  }}
                >
                  Taking a condition photo uses the phone camera, which a browser build does not
                  have. Use the app on a device, or add photos from the asset page in the web app.
                </Text>
              </View>
            ) : !permission?.granted ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <Ionicons name="camera-outline" size={34} color={c.muted} />
                <Text
                  style={{
                    color: c.muted,
                    fontSize: 13,
                    textAlign: 'center',
                    marginTop: spacing.md,
                    marginBottom: spacing.lg,
                  }}
                >
                  The camera is needed to record what this equipment looks like.
                </Text>
                <Button label="Allow camera" onPress={requestPermission} />
              </View>
            ) : pending ? (
              <>
                {/* Reviewed before it is kept: a blurred shot of a scratch is
                    worse than none, because it looks like evidence. */}
                <Image
                  source={{ uri: pending }}
                  style={{
                    width: '100%',
                    height: 320,
                    borderRadius: radius.md,
                    backgroundColor: c.border,
                  }}
                  resizeMode="cover"
                />
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Retake" variant="secondary" onPress={() => setPending(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={busy ? 'Saving…' : 'Save photo'} onPress={upload} disabled={busy} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <CameraView
                  ref={cameraRef}
                  style={{ width: '100%', height: 320, borderRadius: radius.md, overflow: 'hidden' }}
                />
                <View style={{ marginTop: spacing.lg }}>
                  <Button label="Take photo" onPress={shoot} />
                </View>
                {saved > 0 ? (
                  <Text
                    style={{
                      color: c.muted,
                      fontSize: 12,
                      textAlign: 'center',
                      marginTop: spacing.md,
                    }}
                  >
                    {saved} photo{saved === 1 ? '' : 's'} saved. Take another, or close.
                  </Text>
                ) : null}
              </>
            )}

            {busy ? <ActivityIndicator color={c.brand} style={{ marginTop: spacing.md }} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
