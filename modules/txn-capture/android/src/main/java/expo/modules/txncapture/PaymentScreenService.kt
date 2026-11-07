package expo.modules.txncapture

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads the visible text of Google Pay's "Payment successful" and transaction-detail screens.
 * The service is limited to the GPay package in res/xml/txn_capture_screen.xml, so it never sees
 * other apps. Only screens that look like a completed payment are queued; parsing happens in JS.
 */
class PaymentScreenService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private val scan = Runnable { scanNow() }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.packageName?.toString() != GPAY) return
    // GPay fires many content-changed events while animating; read once things settle.
    handler.removeCallbacks(scan)
    handler.postDelayed(scan, SETTLE_MS)
  }

  override fun onInterrupt() {}

  private fun scanNow() {
    try {
      val root = rootInActiveWindow ?: return
      if (root.packageName?.toString() != GPAY) return
      val lines = ArrayList<String>()
      collect(root, lines, 0)
      val text = lines.joinToString("\n").take(MAX_CHARS)
      if (!text.contains('₹') || !TRIGGER.containsMatchIn(text)) return
      synchronized(recent) {
        if (recent.contains(text)) return
        recent.addLast(text)
        if (recent.size > 30) recent.removeFirst()
      }
      CaptureStore.record(applicationContext, "screen", GPAY, text, System.currentTimeMillis())
    } catch (_: Exception) {
      // Never crash the accessibility service on an unexpected view tree.
    }
  }

  private fun collect(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
    if (node == null || depth > 40 || out.size > 400) return
    val t = node.text?.toString()?.trim().orEmpty()
    if (t.isNotEmpty()) out.add(t)
    val d = node.contentDescription?.toString()?.trim().orEmpty()
    if (d.isNotEmpty() && d != t) out.add(d)
    for (i in 0 until node.childCount) collect(node.getChild(i), out, depth + 1)
  }

  companion object {
    const val GPAY = "com.google.android.apps.nbu.paisa.user"
    private const val SETTLE_MS = 900L
    private const val MAX_CHARS = 4000
    /** Words that appear on a finished payment (success screen or the payment-details page). */
    private val TRIGGER = Regex("(?i)(upi transaction id|upi ref|transaction id|payment successful|paid successfully|sent successfully|completed|received)")
    private val recent = ArrayDeque<String>()
  }
}
