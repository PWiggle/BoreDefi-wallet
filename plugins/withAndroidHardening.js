const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

/**
 * Android hardening for a self-custody wallet:
 * - android:allowBackup="false", and backup / device-transfer rules that exclude every data domain
 *   (allowBackup=false alone does not stop Android 12+ device-to-device transfer).
 * - FileProvider paths narrowed. These files override the libraries' resources of the same name:
 *   react-native-webview (camera capture for <input type=file>) only needs the app's own external
 *   files dir, not all of external storage; expo-file-system's provider is limited to a share/ folder
 *   (the app does not share files through it today).
 */
const BACKUP_RULES = 'boredefi_backup_rules';
const EXTRACTION_RULES = 'boredefi_data_extraction_rules';
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

const excludeAll = (indent) => DOMAINS.map((d) => `${indent}<exclude domain="${d}" path="." />`).join('\n');

const FILES = {
  [`${BACKUP_RULES}.xml`]: `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 and lower: nothing from this wallet is backed up. -->
<full-backup-content>
${excludeAll('  ')}
</full-backup-content>
`,
  [`${EXTRACTION_RULES}.xml`]: `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 and higher: no cloud backup and no device-to-device transfer of wallet data. -->
<data-extraction-rules>
  <cloud-backup>
${excludeAll('    ')}
  </cloud-backup>
  <device-transfer>
${excludeAll('    ')}
  </device-transfer>
</data-extraction-rules>
`,
  // Overrides react-native-webview's <external-path path="."/>.
  'file_provider_paths.xml': `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <external-files-path name="shared" path="." />
</paths>
`,
  // Overrides expo-file-system's whole files/ + cache/ dirs.
  'file_system_provider_paths.xml': `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <files-path name="expo_files" path="share/" />
  <cache-path name="cached_expo_files" path="share/" />
</paths>
`,
};

function withHardeningResources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      for (const [name, contents] of Object.entries(FILES)) {
        fs.writeFileSync(path.join(xmlDir, name), contents);
      }
      return cfg;
    },
  ]);
}

function withHardeningManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:allowBackup'] = 'false';
    app.$['android:fullBackupContent'] = `@xml/${BACKUP_RULES}`;
    app.$['android:dataExtractionRules'] = `@xml/${EXTRACTION_RULES}`;
    return cfg;
  });
}

module.exports = function withAndroidHardening(config) {
  return withHardeningManifest(withHardeningResources(config));
};
module.exports.FILES = FILES;
