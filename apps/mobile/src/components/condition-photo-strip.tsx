import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, ScrollView, Text, View } from 'react-native';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { Card, SectionTitle } from './ui';

/**
 * Condition photos for one asset, on a phone (v2.33).
 *
 * The web lays handover and return side by side in two columns. A phone has no
 * room for that, so each custody event becomes a block: who held it and the
 * condition at each end as a line of text, then the photos in a single
 * horizontal strip that reads left to right in the order they were taken -
 * handover first, return after.
 *
 * The labels do the work the columns did on the web. Without them a strip of
 * photographs of the same laptop says nothing about which were taken when,
 * which is the entire question.
 */

interface Photo {
  id: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
}

interface CustodyGroup {
  assignmentId: string;
  holder: string | null;
  assignedAt: string;
  conditionOut: string;
  returnedAt: string | null;
  conditionIn: string | null;
  open: boolean;
  handover: Photo[];
  returned: Photo[];
}

/**
 * One thumbnail, fetched with the session's bearer token.
 *
 * Native <Image> honours `source.headers`; react-native-web ignores them and
 * silently renders nothing at all - no element, not even a failed request - so
 * on the browser build the strip appeared as labels with no pictures. The
 * browser build is how this app gets reviewed on a laptop, so it fetches the
 * bytes and hands over an object URL there instead, exactly as the web app
 * does. Native keeps the cheaper path.
 */
function Thumb({
  uri,
  headers,
  label,
  caption,
}: {
  uri: string;
  headers: Record<string, string>;
  label: string;
  caption: string | null;
}) {
  const { c, radius } = useTheme();
  const [webUri, setWebUri] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(uri, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setWebUri(objectUrl);
      } catch {
        // A thumbnail that will not load is left blank; the label still says
        // which end of the handover it belonged to.
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, headers]);

  const source = Platform.OS === 'web' ? (webUri ? { uri: webUri } : null) : { uri, headers };

  return (
    <Image
      source={source ?? undefined}
      style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: c.border }}
      resizeMode="cover"
      accessibilityLabel={caption ?? `${label} photo`}
    />
  );
}

/** `refreshKey` changes to force a reload after the camera sheet saves one. */
export function ConditionPhotoStrip({
  assetId,
  refreshKey = 0,
}: {
  assetId: string;
  refreshKey?: number;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [groups, setGroups] = useState<CustodyGroup[] | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await api.request<CustodyGroup[]>(`/assets/${assetId}/photos`));
    } catch {
      // A failed photo list must not blank the asset screen around it - the
      // section simply stays empty.
      setGroups([]);
    }
  }, [api, assetId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const withPhotos = (groups ?? []).filter((g) => g.handover.length + g.returned.length > 0);
  if (withPhotos.length === 0) return null;

  const thumb = (photo: Photo, label: string) => {
    const src = api.imageSource(`/assets/${assetId}/photos/${photo.id}`);
    return (
    <View key={photo.id} style={{ marginRight: spacing.md }}>
      <Thumb uri={src.uri} headers={src.headers} label={label} caption={photo.caption} />
      <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>{label}</Text>
      {photo.by ? (
        <Text style={{ color: c.muted, fontSize: 11 }} numberOfLines={1}>
          {photo.by}
        </Text>
      ) : null}
    </View>
    );
  };

  return (
    <>
      <SectionTitle>Condition photos</SectionTitle>
      {withPhotos.map((g) => (
        <Card key={g.assignmentId} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
            {g.holder ?? 'Unknown holder'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.md }}>
            {new Date(g.assignedAt).toLocaleDateString()}
            {g.returnedAt ? ` → ${new Date(g.returnedAt).toLocaleDateString()}` : ' → still out'}
            {'  ·  '}
            {g.conditionOut}
            {g.conditionIn ? ` → ${g.conditionIn}` : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {g.handover.map((p) => thumb(p, 'Handover'))}
            {g.returned.map((p) => thumb(p, 'Return'))}
          </ScrollView>
        </Card>
      ))}
    </>
  );
}
