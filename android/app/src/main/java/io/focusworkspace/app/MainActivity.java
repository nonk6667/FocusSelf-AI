package io.focusworkspace.app;

import android.content.res.Configuration;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final float MAX_REFRESH_RATE = 120f;
    private DisplayManager displayManager;
    private boolean foreground;
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId) { requestHighRefreshRate(); }
        @Override public void onDisplayRemoved(int displayId) { requestHighRefreshRate(); }
        @Override public void onDisplayChanged(int displayId) { requestHighRefreshRate(); }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackupFilesPlugin.class);
        registerPlugin(LocalAIPlugin.class);
        super.onCreate(savedInstanceState);
        displayManager = (DisplayManager) getSystemService(DISPLAY_SERVICE);
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
        if (displayManager != null) {
            displayManager.registerDisplayListener(displayListener, new Handler(Looper.getMainLooper()));
        }
        requestHighRefreshRate();
    }

    @Override
    public void onPause() {
        foreground = false;
        if (displayManager != null) displayManager.unregisterDisplayListener(displayListener);
        // Release the preference when leaving the app; no background rendering or wake lock.
        setPreferredRefreshRate(0f);
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) requestHighRefreshRate();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // Foldables can move the window to another display with different mode IDs.
        getWindow().getDecorView().post(this::requestHighRefreshRate);
    }

    private void requestHighRefreshRate() {
        if (!foreground) return;
        View decor = getWindow().getDecorView();
        Display display = decor.getDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        float preferred = 0f;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight()
                    // Display APIs can report 120 Hz as 120.00001 Hz.
                    && mode.getRefreshRate() <= MAX_REFRESH_RATE + 0.5f) {
                preferred = Math.max(preferred, mode.getRefreshRate());
            }
        }
        setPreferredRefreshRate(preferred);
    }

    private void setPreferredRefreshRate(float rate) {
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        if (Math.abs(attributes.preferredRefreshRate - rate) > 0.01f) {
            // Request only a rate, allowing Android to retain resolution and honor device policy.
            attributes.preferredRefreshRate = rate;
            getWindow().setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            float viewRate = rate > 0f ? rate : View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT;
            getWindow().getDecorView().setRequestedFrameRate(viewRate);
            if (bridge != null && bridge.getWebView() != null) {
                // ViewGroup preferences do not automatically propagate to the WebView.
                bridge.getWebView().setRequestedFrameRate(viewRate);
            }
        }
    }
}
