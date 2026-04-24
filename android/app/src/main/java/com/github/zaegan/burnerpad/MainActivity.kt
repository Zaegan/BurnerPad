package com.github.zaegan.burnerpad

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "BurnerPadApp"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    /**
     * Do not save Activity instance state across process death.
     *
     * react-native-screens stores the navigation Fragment back stack in
     * savedInstanceState. When the OS kills the process after extended
     * backgrounding and the user returns via Recents, Android tries to
     * restore those Fragments. This conflicts with React Navigation
     * re-initialising from scratch (always starting at the PIN screen),
     * producing a native IllegalStateException crash in the Fragment manager.
     *
     * BurnerPad intentionally starts fresh from PIN on every cold start, so
     * there is no value in saving the prior navigation state — and doing so
     * is a security concern anyway (it could reveal which screen was open).
     */
    override fun onSaveInstanceState(outState: Bundle) {
        // Deliberately omit super call to prevent Fragment back stack from
        // being saved. React Native's JS state is not stored here, so omitting
        // this does not affect note content or app data.
    }
}
