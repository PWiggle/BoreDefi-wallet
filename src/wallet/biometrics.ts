import * as LocalAuthentication from 'expo-local-authentication';

export async function biometricAvailability(): Promise<{
  hardware: boolean;
  enrolled: boolean;
  label: string;
}> {
  const [hardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  return {
    hardware,
    enrolled,
    label: hasFace ? 'Face ID / biometrics' : 'Biometrics',
  };
}

export async function authenticateBiometrics(promptMessage = 'Unlock BoreDefi Wallet'): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Use PIN',
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
  });
  return result.success;
}
