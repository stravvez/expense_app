import * as BackgroundTask from 'expo-background-task';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { DB_NAME, migrate } from '../db/schema';
import { refreshWidgetNow } from '../widget/refresh';
import { drainNativeQueue } from './pipeline';

/**
 * Safety net: captures are always stored natively the instant the SMS/notification arrives.
 * When the app is open (or its JS is alive in background) they are processed immediately;
 * otherwise this periodic task (≈ every 15 min, OS-scheduled) processes them and posts alerts.
 */
export const DRAIN_TASK = 'paisa-drain-captures';

TaskManager.defineTask(DRAIN_TASK, async () => {
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(db);
    const stats = await drainNativeQueue(db);
    if (stats) await refreshWidgetNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('background drain failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerDrainTask() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (!(await TaskManager.isTaskRegisteredAsync(DRAIN_TASK))) {
    await BackgroundTask.registerTaskAsync(DRAIN_TASK, { minimumInterval: 15 });
  }
}
