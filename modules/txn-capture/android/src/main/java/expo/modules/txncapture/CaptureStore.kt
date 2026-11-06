package expo.modules.txncapture

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Durable native queue. Receivers write here immediately, even when the JS runtime is not
 * running; JS drains the queue and acknowledges processed ids, so nothing is ever lost.
 */
class CaptureStore private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, "txn_capture_queue.db", null, 1) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        ts INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      )
      """.trimIndent()
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

  fun insert(source: String, sender: String, body: String, ts: Long): Long {
    val values = ContentValues().apply {
      put("source", source)
      put("sender", sender)
      put("body", body)
      put("ts", ts)
      put("received_at", System.currentTimeMillis())
    }
    return writableDatabase.insert("events", null, values)
  }

  fun fetchAll(limit: Int = 500): List<Map<String, Any>> {
    val out = mutableListOf<Map<String, Any>>()
    readableDatabase.rawQuery(
      "SELECT id, source, sender, body, ts FROM events ORDER BY id ASC LIMIT ?",
      arrayOf(limit.toString())
    ).use { c ->
      while (c.moveToNext()) {
        out.add(
          mapOf(
            "id" to c.getLong(0).toDouble(),
            "source" to c.getString(1),
            "sender" to c.getString(2),
            "body" to c.getString(3),
            "ts" to c.getLong(4).toDouble()
          )
        )
      }
    }
    return out
  }

  fun delete(ids: List<Long>) {
    if (ids.isEmpty()) return
    val db = writableDatabase
    db.beginTransaction()
    try {
      ids.forEach { db.delete("events", "id = ?", arrayOf(it.toString())) }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun count(): Int =
    readableDatabase.rawQuery("SELECT COUNT(*) FROM events", null).use { c ->
      if (c.moveToFirst()) c.getInt(0) else 0
    }

  companion object {
    @Volatile private var instance: CaptureStore? = null

    fun get(context: Context): CaptureStore =
      instance ?: synchronized(this) {
        instance ?: CaptureStore(context).also { instance = it }
      }

    /** Set by the module while the JS runtime is alive, so captures are pushed live. */
    @Volatile var listener: (() -> Unit)? = null

    fun record(context: Context, source: String, sender: String, body: String, ts: Long) {
      get(context).insert(source, sender, body, ts)
      try {
        listener?.invoke()
      } catch (_: Throwable) {
      }
    }
  }
}
