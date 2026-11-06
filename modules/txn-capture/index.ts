import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type RawCapture = {
  id: number;
  source: 'sms' | 'notif';
  /** SMS sender id (e.g. "AD-UNIONB") or app package name for notifications */
  sender: string;
  body: string;
  /** epoch ms */
  ts: number;
};

type Events = { onCaptured: (e: { pending: number }) => void };

declare class TxnCaptureNative extends NativeModule<Events> {
  drainQueue(): Promise<RawCapture[]>;
  ackEvents(ids: number[]): Promise<void>;
  pendingCount(): Promise<number>;
  readInbox(sinceMs: number, maxCount: number): Promise<RawCapture[]>;
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
}

/** null when running somewhere without the native module (Expo Go, web, tests). */
const TxnCapture = requireOptionalNativeModule<TxnCaptureNative>('TxnCapture');

export default TxnCapture;
