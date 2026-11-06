package expo.modules.txncapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Receives every incoming SMS and queues anything that looks like a bank transaction alert. */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    if (messages.isEmpty()) return

    // Multipart SMS arrive as several PDUs; join them per sender.
    messages.groupBy { it.originatingAddress ?: "" }.forEach { (sender, parts) ->
      val body = parts.joinToString("") { it.messageBody ?: "" }
      val ts = parts.first().timestampMillis
      if (looksFinancial(body)) {
        CaptureStore.record(context, "sms", sender, body, ts)
      }
    }
  }

  companion object {
    private val keywords = Regex(
      "(debit|credit|rs\\.?|inr|₹|a/c|upi|txn|transaction)",
      RegexOption.IGNORE_CASE
    )

    /** Cheap pre-filter so personal SMS are never stored; real parsing happens in JS. */
    fun looksFinancial(body: String): Boolean = keywords.containsMatchIn(body)
  }
}
