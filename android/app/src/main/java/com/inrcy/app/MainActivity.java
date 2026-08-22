package com.inrcy.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android 15+ enforces edge-to-edge for apps targeting API 35 or newer.
        // Keep the system chrome readable and reserve the status-bar area before
        // the remote WebView renders the first dashboard pixel.
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(true);

        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        View webView = getBridge().getWebView();
        // The inset area is part of the WebView once edge-to-edge is enabled;
        // keep it white like the browser/PWA system-bar strip.
        webView.setBackgroundColor(Color.WHITE);
        final int basePaddingLeft = webView.getPaddingLeft();
        final int basePaddingTop = webView.getPaddingTop();
        final int basePaddingRight = webView.getPaddingRight();
        final int basePaddingBottom = webView.getPaddingBottom();

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            int leftInset = Math.max(statusBars.left, displayCutout.left);
            int topInset = Math.max(statusBars.top, displayCutout.top);
            int rightInset = Math.max(statusBars.right, displayCutout.right);

            // Apply only the top/side inset here. The WebView keeps receiving
            // navigation-bar and IME insets so the existing CSS safe-area and
            // keyboard handling continue to work without double padding.
            view.setPadding(
                    basePaddingLeft + leftInset,
                    basePaddingTop + topInset,
                    basePaddingRight + rightInset,
                    basePaddingBottom
            );

            return new WindowInsetsCompat.Builder(insets)
                    .setInsets(
                            WindowInsetsCompat.Type.statusBars()
                                    | WindowInsetsCompat.Type.displayCutout(),
                            Insets.NONE
                    )
                    .build();
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
