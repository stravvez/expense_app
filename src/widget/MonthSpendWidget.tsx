import { FlexWidget, TextWidget } from 'react-native-android-widget';

export const WIDGET_NAME = 'MonthSpend'; // must match the name in app.json's widget plugin config

export type MonthSpendData = { month: string; spent: string; today: string; count: number };

const C = { card: '#FFFFFF', text: '#14171F', muted: '#6B7280', brand: '#5B3FD9', onBrand: '#FFFFFF' } as const;

/**
 * Home-screen widget: this month's spending, plus a "+ Cash" button for manual entries.
 * Tapping anywhere else opens the app. Widgets render to native views, so only
 * react-native-android-widget primitives are allowed here, not React Native components.
 */
export function MonthSpendWidget({ data }: { data: MonthSpendData | null }) {
  const payments = data ? `${data.count} payment${data.count === 1 ? '' : 's'}` : '';
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Open UPI Diary"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: C.card,
        borderRadius: 24,
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <TextWidget text={data ? `Spent in ${data.month}` : 'UPI Diary'} style={{ fontSize: 14, color: C.muted }} />
      <TextWidget
        text={data ? data.spent : 'Open the app to start'}
        maxLines={1}
        style={{ fontSize: data ? 34 : 16, fontWeight: 'bold', color: C.text }}
      />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={data ? `${data.today} today · ${payments}` : ''}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 13, color: C.muted }}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'paisatracker://add-transaction' }}
          accessibilityLabel="Add cash expense"
          style={{ backgroundColor: C.brand, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <TextWidget text="+ Cash" style={{ fontSize: 14, fontWeight: 'bold', color: C.onBrand }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
