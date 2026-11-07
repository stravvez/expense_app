import * as Notifications from 'expo-notifications';
import { PermissionsAndroid } from 'react-native';
import TxnCapture from '../../modules/txn-capture';

export type PermState = { sms: boolean; notifAccess: boolean; screen: boolean; battery: boolean; alerts: boolean; nativeAvailable: boolean };

export async function getPermState(): Promise<PermState> {
  const sms =
    (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS)) &&
    (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS));
  const alerts = (await Notifications.getPermissionsAsync()).granted;
  return {
    sms,
    alerts,
    nativeAvailable: !!TxnCapture,
    notifAccess: TxnCapture?.isNotificationAccessGranted() ?? false,
    screen: TxnCapture?.isScreenCaptureEnabled?.() ?? false,
    battery: TxnCapture?.isIgnoringBatteryOptimizations() ?? false,
  };
}

export async function requestSms() {
  const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_SMS, PermissionsAndroid.PERMISSIONS.RECEIVE_SMS]);
  return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

export async function requestAlerts() {
  return (await Notifications.requestPermissionsAsync()).granted;
}
