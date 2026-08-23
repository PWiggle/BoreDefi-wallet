import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { Screen } from '../components/Screen';
import type { MainStackParamList } from '../navigation';
import { colors } from '../theme';
import { parsePaymentUri } from '../wallet/qr';

export function ScanQrScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!permission) {
    return (
      <Screen title="Scan QR">
        <Text style={styles.hint}>Checking camera permission…</Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen title="Camera access" subtitle="Needed to scan a recipient address.">
        <Button label="Allow camera" onPress={requestPermission} />
      </Screen>
    );
  }

  return (
    <Screen title="Scan QR" scroll={false}>
      <ErrorBanner message={error} />
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (done) {
              return;
            }
            try {
              const parsed = parsePaymentUri(data);
              setDone(true);
              navigation.navigate('Send', { to: parsed.address, amount: parsed.amount });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not read that QR code.');
            }
          }}
        />
      </View>
      <Text style={styles.hint}>Point the camera at an Ethereum address or payment QR.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraWrap: {
    flex: 1,
    minHeight: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  hint: {
    color: colors.muted,
    textAlign: 'center',
  },
});
