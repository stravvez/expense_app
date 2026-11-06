package expo.modules.txncapture

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TxnCaptureModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TxnCapture")

    Events("onCaptured")

    OnCreate {
      CaptureStore.listener = {
        this@TxnCaptureModule.sendEvent("onCaptured", bundleOf("pending" to 1))
      }
    }

    OnDestroy {
      CaptureStore.listener = null
    }

    /** Pending raw events captured natively, oldest first. Call ackEvents() after processing. */
    AsyncFunction("drainQueue") {
      CaptureStore.get(context).fetchAll()
    }

    AsyncFunction("ackEvents") { ids: List<Double> ->
      CaptureStore.get(context).delete(ids.map { it.toLong() })
    }

    AsyncFunction("pendingCount") {
      CaptureStore.get(context).count()
    }

    /** Reads SMS inbox (requires READ_SMS granted) for backfill. */
    AsyncFunction("readInbox") { sinceMs: Double, maxCount: Int ->
      val out = mutableListOf<Map<String, Any>>()
      val uri = Uri.parse("content://sms/inbox")
      val projection = arrayOf("_id", "address", "body", "date", "date_sent")
      context.contentResolver.query(
        uri, projection, "date >= ?", arrayOf(sinceMs.toLong().toString()), "date DESC"
      )?.use { c ->
        while (c.moveToNext() && out.size < maxCount) {
          val body = c.getString(2) ?: continue
          if (!SmsReceiver.looksFinancial(body)) continue
          val dateSent = c.getLong(4)
          out.add(
            mapOf(
              "id" to c.getLong(0).toDouble(),
              "source" to "sms",
              "sender" to (c.getString(1) ?: ""),
              "body" to body,
              // date_sent matches SmsMessage.timestampMillis used by the live receiver
              "ts" to (if (dateSent > 0) dateSent else c.getLong(3)).toDouble()
            )
          )
        }
      }
      out
    }

    Function("isNotificationAccessGranted") {
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      val me = ComponentName(context, PaymentNotificationListener::class.java)
      flat.split(":").any { ComponentName.unflattenFromString(it) == me }
    }

    Function("openNotificationAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    @SuppressLint("BatteryLife")
    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
