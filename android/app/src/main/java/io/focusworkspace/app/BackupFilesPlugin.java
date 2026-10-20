package io.focusworkspace.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Save a backup with Android's document picker; no storage permission needed. */
@CapacitorPlugin(name = "BackupFiles")
public class BackupFilesPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "focus-backup.json");
        String data = call.getString("data");
        if (data == null || data.length() > 8 * 1024 * 1024) {
            call.reject("备份数据无效或超过 8 MB");
            return;
        }
        if (!name.matches("[a-zA-Z0-9._-]+")) name = "focus-backup.json";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("已取消导出");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) { call.reject("未选择保存位置"); return; }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("无法打开目标文件");
            out.write(call.getString("data", "").getBytes(StandardCharsets.UTF_8));
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法保存备份文件", error);
        }
    }
}
