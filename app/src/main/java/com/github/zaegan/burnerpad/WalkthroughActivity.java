package com.github.zaegan.burnerpad;

import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.tutorial.TutorialManager;

/**
 * First-launch walkthrough shown once after initial PIN setup. 4 slides.
 * Navigates to FileBrowserActivity on finish.
 */
public class WalkthroughActivity extends AppCompatActivity {

    private static final String[][] SLIDES = {
        {"welcome",       "BurnerPad keeps your notes encrypted on this device.\nNo accounts. No sync. No one else can read them."},
        {"how it works",  "Your PIN encrypts a key that locks every note.\nWithout your PIN, the data is unreadable — even to us."},
        {"duress PIN",    "In Settings you can set a duress PIN.\nEntering it silently wipes everything and opens a blank app. Only set one if you need it."},
        {"you're ready",  "That's all there is to know.\nTap 'start' to open your notes."},
    };

    private int      currentIndex = 0;
    private TextView tvTitle, tvBody, btnNext;
    private LinearLayout dotsContainer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_walkthrough);

        tvTitle       = findViewById(R.id.tvTitle);
        tvBody        = findViewById(R.id.tvBody);
        btnNext       = findViewById(R.id.btnNext);
        dotsContainer = findViewById(R.id.dotsContainer);

        buildDots();
        updateSlide();

        btnNext.setOnClickListener(v -> onNextPressed());
        findViewById(R.id.tvSkip).setOnClickListener(v -> finish());
        findViewById(R.id.tvDeclineAll).setOnClickListener(v -> {
            TutorialManager.declineAll();
            finish();
        });
    }

    private void onNextPressed() {
        if (currentIndex < SLIDES.length - 1) {
            currentIndex++;
            updateSlide();
        } else {
            finish();
        }
    }

    private void updateSlide() {
        tvTitle.setText(SLIDES[currentIndex][0]);
        tvBody.setText(SLIDES[currentIndex][1]);
        btnNext.setText(currentIndex == SLIDES.length - 1 ? "start →" : "next →");
        updateDots();
    }

    private void buildDots() {
        dotsContainer.removeAllViews();
        int dp4 = dp(4);
        int dp8 = dp(8);
        for (int i = 0; i < SLIDES.length; i++) {
            View dot = new View(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp4, dp4);
            lp.setMarginEnd(dp8);
            dot.setLayoutParams(lp);
            dot.setTag("dot_" + i);
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(getThemeColor(i == 0 ? R.attr.textPrimary : R.attr.textMicro));
            dot.setBackground(circle);
            dotsContainer.addView(dot);
        }
    }

    private void updateDots() {
        for (int i = 0; i < SLIDES.length; i++) {
            View dot = dotsContainer.findViewWithTag("dot_" + i);
            if (dot != null) {
                GradientDrawable circle = new GradientDrawable();
                circle.setShape(GradientDrawable.OVAL);
                circle.setColor(getThemeColor(i == currentIndex ? R.attr.textPrimary : R.attr.textMicro));
                dot.setBackground(circle);
            }
        }
    }

    @Override
    public void finish() {
        PinManager.setWalkthroughSeen();
        Intent intent = new Intent(this, FileBrowserActivity.class);
        intent.putExtra(FileBrowserActivity.EXTRA_PATH, "");
        startActivity(intent);
        super.finish();
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private int getThemeColor(int attr) {
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(attr, tv, true);
        return tv.data;
    }
}
