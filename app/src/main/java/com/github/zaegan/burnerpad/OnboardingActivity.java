package com.github.zaegan.burnerpad;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatActivity;

import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.storage.StorageManager;
import com.github.zaegan.burnerpad.tutorial.TutorialManager;

/**
 * First-launch PIN setup.
 * Steps: welcome → pin_behavior → setpin
 * After setup → WalkthroughActivity (if not seen) or FileBrowserActivity.
 */
public class OnboardingActivity extends AppCompatActivity {

    private static final int STEP_WELCOME      = 0;
    private static final int STEP_PIN_BEHAVIOR = 1;
    private static final int STEP_SET_PIN      = 2;

    private LinearLayout stepWelcome, stepPinBehavior, stepSetPin;
    private TextView     tvTagline, tvError, tvSkip, tvDeclineAll;
    private Button       btnNext;
    private EditText     etPin, etConfirmPin;

    private int     step         = STEP_WELCOME;
    private boolean isProcessing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_onboarding);

        stepWelcome     = findViewById(R.id.stepWelcome);
        stepPinBehavior = findViewById(R.id.stepPinBehavior);
        stepSetPin      = findViewById(R.id.stepSetPin);
        tvTagline       = findViewById(R.id.tvTagline);
        tvError         = findViewById(R.id.tvError);
        tvSkip          = findViewById(R.id.tvSkip);
        tvDeclineAll    = findViewById(R.id.tvDeclineAll);
        btnNext         = findViewById(R.id.btnNext);
        etPin           = findViewById(R.id.etPin);
        etConfirmPin    = findViewById(R.id.etConfirmPin);

        updateStep();

        btnNext.setOnClickListener(v -> onNextPressed());
        tvSkip.setOnClickListener(v -> goToSetPin());
        tvDeclineAll.setOnClickListener(v -> {
            TutorialManager.declineAll();
            goToSetPin();
        });

        etConfirmPin.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                onNextPressed();
                return true;
            }
            return false;
        });
    }

    private void onNextPressed() {
        switch (step) {
            case STEP_WELCOME:      step = STEP_PIN_BEHAVIOR; updateStep(); break;
            case STEP_PIN_BEHAVIOR: goToSetPin();             break;
            case STEP_SET_PIN:      handleFinish();           break;
        }
    }

    private void goToSetPin() {
        step = STEP_SET_PIN;
        updateStep();
    }

    private void updateStep() {
        stepWelcome.setVisibility(step == STEP_WELCOME      ? View.VISIBLE : View.GONE);
        stepPinBehavior.setVisibility(step == STEP_PIN_BEHAVIOR ? View.VISIBLE : View.GONE);
        stepSetPin.setVisibility(step == STEP_SET_PIN       ? View.VISIBLE : View.GONE);

        switch (step) {
            case STEP_WELCOME:      tvTagline.setText("encrypted. plain. private."); btnNext.setText("next →");           break;
            case STEP_PIN_BEHAVIOR: tvTagline.setText("about your PIN");              btnNext.setText("set my PIN →");     break;
            case STEP_SET_PIN:      tvTagline.setText("set your PIN");                btnNext.setText("Create BurnerPad →"); break;
        }

        // Skip/decline links only shown for tutorial steps, hidden on setpin
        boolean tutorial = step != STEP_SET_PIN;
        tvSkip.setVisibility(tutorial ? View.VISIBLE : View.GONE);
        tvDeclineAll.setVisibility(tutorial ? View.VISIBLE : View.GONE);
        // Show separator dot only when both links visible
        View sep = ((View) tvSkip.getParent()).findViewWithTag("sep_dot");
        // The dot TextView is between them — just use visibility of parent row
        ((View) tvSkip.getParent()).setVisibility(tutorial ? View.VISIBLE : View.GONE);
    }

    private void handleFinish() {
        if (isProcessing) return;
        String pin        = etPin.getText().toString();
        String confirmPin = etConfirmPin.getText().toString();
        tvError.setVisibility(View.GONE);

        if (pin.length() < PinManager.MIN_PIN_LENGTH) {
            showError("PIN must be at least " + PinManager.MIN_PIN_LENGTH + " characters.");
            return;
        }
        if (!pin.equals(confirmPin)) {
            showError("PINs do not match.");
            etConfirmPin.setText("");
            return;
        }

        isProcessing = true;
        btnNext.setEnabled(false);
        btnNext.setText("Setting up…");

        new Thread(() -> {
            try {
                PinManager.initialize(pin);
                StorageManager.createDefaultNote();
                boolean seen = PinManager.getWalkthroughSeen();
                runOnUiThread(() -> {
                    if (seen) {
                        Intent intent = new Intent(this, FileBrowserActivity.class);
                        intent.putExtra(FileBrowserActivity.EXTRA_PATH, "");
                        startActivity(intent);
                    } else {
                        startActivity(new Intent(this, WalkthroughActivity.class));
                    }
                    finish();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    isProcessing = false;
                    btnNext.setEnabled(true);
                    btnNext.setText("Create BurnerPad →");
                    showError(e.getMessage() != null ? e.getMessage() : "Setup failed.");
                });
            }
        }).start();
    }

    private void showError(String msg) {
        tvError.setText(msg);
        tvError.setVisibility(View.VISIBLE);
    }
}
