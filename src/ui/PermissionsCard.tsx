import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import TxnCapture from '../../modules/txn-capture';
import { getPermState, requestAlerts, requestSms, type PermState } from '../capture/permissions';
import { Body, Button, Card, Muted, Row, Title } from './components';
import { useTheme } from './theme';

function Step({ done, title, hint, action, onPress }: { done: boolean; title: string; hint: string; action: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Row style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
      <Body style={{ fontSize: 18, width: 26 }}>{done ? '✅' : '⬜️'}</Body>
      <View style={{ flex: 1, gap: 2 }}>
        <Body style={{ fontWeight: '600' }}>{title}</Body>
        <Muted>{hint}</Muted>
      </View>
      {!done && <Button title={action} kind="secondary" onPress={onPress} style={{ height: 36, paddingHorizontal: 12 }} />}
      {done && <Muted style={{ color: t.success, fontWeight: '700' }}>On</Muted>}
    </Row>
  );
}

export function PermissionsCard({ onChange }: { onChange?: (s: PermState) => void }) {
  const [s, setS] = useState<PermState>();
  const refresh = useCallback(() => {
    getPermState().then((x) => {
      setS(x);
      onChange?.(x);
    });
  }, [onChange]);

  useFocusEffect(refresh);
  useEffect(() => {
    // returning from Android settings screens
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  if (!s) return null;
  if (!s.nativeAvailable)
    return (
      <Card>
        <Title>Auto-capture unavailable</Title>
        <Muted>This build has no capture module (Expo Go?). Install the development build / APK to track payments automatically.</Muted>
      </Card>
    );

  return (
    <Card>
      <Title>Auto-capture</Title>
      <Step
        done={s.sms}
        title="Read bank SMS"
        hint="Every Union Bank UPI debit/credit SMS becomes a transaction. Only bank alerts are stored; other SMS are ignored."
        action="Allow"
        onPress={() => requestSms().then(refresh)}
      />
      <Step
        done={s.notifAccess}
        title="Read Google Pay notifications"
        hint="Adds the merchant or person name. In the list, find “Paisa Tracker” and switch it on."
        action="Open"
        onPress={() => TxnCapture?.openNotificationAccessSettings()}
      />
      <Step
        done={s.battery}
        title="Run in background"
        hint="Stops Android from killing capture. On Xiaomi/Oppo/Vivo/Realme, also enable Autostart for this app."
        action="Allow"
        onPress={() => TxnCapture?.requestIgnoreBatteryOptimizations()}
      />
      <Step done={s.alerts} title="Expense alerts" hint="A notification for each captured payment, with a quick Split button." action="Allow" onPress={() => requestAlerts().then(refresh)} />
    </Card>
  );
}
