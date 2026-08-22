package com.inrcy.app;

import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android 15+ enforces edge-to-edge for apps targeting API 35 or newer.
        // Capacitor 8's SystemBars plugin owns the inset dispatch; the web layer
        // consumes its CSS safe-area variables for the dashboard and dock.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(true);

        if (getBridge() != null && getBridge().getWebView() != null) {
            // Capacitor 8's SystemBars plugin owns the parent inset listener.
            // The web layer consumes its injected --safe-area-inset-* values;
            // adding a second WebView listener here would double-pad some
            // Android/WebView combinations and push the dock under navigation.
            getBridge().getWebView().setBackgroundColor(Color.WHITE);
        }
    }
}
