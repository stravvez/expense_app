package expo.modules.txncapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** Listens to notifications from Google Pay (and Union Bank's app) and queues them. */
class PaymentNotificationListener : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in WATCHED_PACKAGES) return
    val extras = sbn.notification?.extras ?: return
    if ((sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
    val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
    val content = if (big.length > text.length) big else text
    val body = listOf(title, content).filter { it.isNotBlank() }.joinToString("\n")
    if (body.isBlank()) return

    // GPay re-posts/updates the same notification; dedupe on key + body.
    val dedupeKey = sbn.key + "|" + body
    synchronized(recent) {
      if (recent.contains(dedupeKey)) return
      recent.add(dedupeKey)
      if (recent.size > 50) recent.removeAt(0)
    }

    CaptureStore.record(applicationContext, "notif", sbn.packageName, body, sbn.postTime)
  }

  companion object {
    val WATCHED_PACKAGES = setOf(
      "com.google.android.apps.nbu.paisa.user", // Google Pay (India)
      "com.infrasoft.uboi" // Union Bank of India – Vyom
    )
    private val recent = mutableListOf<String>()
  }
}
