import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { loadMonthSpend } from './data';
import { MonthSpendWidget, WIDGET_NAME } from './MonthSpendWidget';

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Redraws the home-screen widget after data changes. Debounced, because one payment can trigger
 * several writes (the SMS, then the GPay notification merging into it, then a category change).
 * Does nothing if no widget has been added.
 */
export function refreshWidget() {
  if (Platform.OS !== 'android') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshWidgetNow();
  }, 800);
}

/** Immediate version for the background task, where a pending timer may never fire. */
export async function refreshWidgetNow() {
  if (Platform.OS !== 'android') return;
  try {
    // renderWidget only runs when a widget is on the home screen, so the queries are skipped otherwise
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: async () => <MonthSpendWidget data={await loadMonthSpend()} />,
    });
  } catch (e) {
    console.warn('widget refresh failed', e);
  }
}
