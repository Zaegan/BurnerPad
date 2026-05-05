package com.github.zaegan.burnerpad;

import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

import com.github.zaegan.burnerpad.prefs.PinManager;

/**
 * Transparent launcher. Routes immediately to Onboarding (first launch) or Pin.
 * Never shown to the user — finishes itself after routing.
 */
public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (!PinManager.isInitialized()) {
            startActivity(new Intent(this, OnboardingActivity.class));
        } else {
            Intent intent = new Intent(this, PinActivity.class);
            intent.putExtra(PinActivity.EXTRA_LAUNCH_MODE, true);
            startActivity(intent);
        }
        finish();
    }
}
