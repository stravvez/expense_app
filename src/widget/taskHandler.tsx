import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { loadMonthSpend } from './data';
import { MonthSpendWidget, WIDGET_NAME } from './MonthSpendWidget';

/** Called by Android (even with the app closed) when the widget is added, resized, or its 30-min timer fires. */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetInfo.widgetName !== WIDGET_NAME) return;
  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const data = await loadMonthSpend().catch((e) => {
        console.warn('widget data failed', e);
        return null;
      });
      renderWidget(<MonthSpendWidget data={data} />);
      break;
    }
    default:
      // WIDGET_DELETED: nothing to clean up. WIDGET_CLICK: both buttons use OPEN_APP / OPEN_URI,
      // which Android handles without calling back into JS.
      break;
  }
}
