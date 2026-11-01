const { AndroidConfig, withAndroidStyles, withMainActivity } = require('expo/config-plugins');

const splashTheme = { name: 'Theme.App.SplashScreen' };

/**
 * The Android 12 splash window draws the status bar unless the splash theme
 * is fullscreen. AppTheme stays normal so the bar can return after welcome.
 */
function withHiddenSplashStatusBar(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: splashTheme,
      name: 'android:windowFullscreen',
      value: 'true',
    });
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: splashTheme,
      name: 'android:windowLayoutInDisplayCutoutMode',
      value: 'shortEdges',
    });
    return config;
  });
}

const HIDE_STATUS_BARS = `    androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).apply {
      systemBarsBehavior =
        androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(androidx.core.view.WindowInsetsCompat.Type.statusBars())
    }
`;

/** Hide the status bar as soon as the splash activity exists, before JS loads. */
function withMainActivityHiddenStatusBar(config) {
  return withMainActivity(config, (config) => {
    const contents = config.modResults.contents ?? config.modResults;
    if (typeof contents !== 'string') {
      throw new Error('MainActivity mod did not return a string');
    }
    if (contents.includes('WindowInsetsCompat.Type.statusBars()')) {
      return config;
    }
    const needle = 'super.onCreate(null)\n';
    if (!contents.includes(needle)) {
      throw new Error('Could not find super.onCreate(null) in MainActivity');
    }
    const next = contents.replace(needle, `${needle}${HIDE_STATUS_BARS}`);
    if (config.modResults.contents) {
      config.modResults.contents = next;
    } else {
      config.modResults = next;
    }
    return config;
  });
}

module.exports = (config) => withMainActivityHiddenStatusBar(withHiddenSplashStatusBar(config));
