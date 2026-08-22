import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

test("native project keeps a portable iOS Swift package manifest", () => {
  const packageManifest = read("ios/App/CapApp-SPM/Package.swift");
  assert.doesNotMatch(packageManifest, /path:\s*"[^"]*\\/);
  assert.match(packageManifest, /path:\s*"\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/app"/);
  assert.match(packageManifest, /path:\s*"\.\.\/\.\.\/\.\.\/node_modules\/@revenuecat\/purchases-capacitor"/);
});

test("native permissions and deep-link registrations match the web runtime", () => {
  const androidManifest = read("android/app/src/main/AndroidManifest.xml");
  const androidStrings = read("android/app/src/main/res/values/strings.xml");
  const iosInfo = read("ios/App/App/Info.plist");

  assert.match(androidManifest, /android\.permission\.CAMERA/);
  assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(androidManifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  assert.match(androidManifest, /android\.intent\.action\.VIEW/);
  assert.match(androidManifest, /android\.intent\.category\.BROWSABLE/);
  assert.match(androidManifest, /android:scheme="inrcy"/);
  assert.match(androidManifest, /android:host="app\.inrcy\.com"/);
  assert.match(androidStrings, /<string name="custom_url_scheme">com\.inrcy\.app<\/string>/);

  assert.match(iosInfo, /NSCameraUsageDescription/);
  assert.match(iosInfo, /NSMicrophoneUsageDescription/);
  assert.match(iosInfo, /CFBundleURLSchemes/);
  assert.match(iosInfo, /<string>inrcy<\/string>/);
  assert.match(iosInfo, /<string>com\.inrcy\.app<\/string>/);
});

test("iOS privacy and associated-domain resources are in the target", () => {
  const privacyPath = resolve(root, "ios/App/App/PrivacyInfo.xcprivacy");
  const entitlementsPath = resolve(root, "ios/App/App/App.entitlements");
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  const privacy = read("ios/App/App/PrivacyInfo.xcprivacy");
  const entitlements = read("ios/App/App/App.entitlements");

  assert.equal(existsSync(privacyPath), true);
  assert.equal(existsSync(entitlementsPath), true);
  assert.match(privacy, /NSPrivacyTracking/);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults/);
  assert.match(entitlements, /com\.apple\.developer\.associated-domains/);
  assert.match(entitlements, /applinks:app\.inrcy\.com/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
});

test("Android release signing is fail-closed and never stores credentials in source", () => {
  const gradle = read("android/app/build.gradle");
  const example = read("android/keystore.properties.example");

  assert.match(gradle, /Release signing is not configured/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.match(example, /CHANGE_ME/);
  assert.doesNotMatch(gradle, /storePassword\s+["'][^$][^"']+["']/);
});

test("Android WebView reserves the status-bar inset without double-padding the dock", () => {
  const activity = read(
    "android/app/src/main/java/com/inrcy/app/MainActivity.java",
  );

  assert.match(activity, /ViewCompat\.setOnApplyWindowInsetsListener/);
  assert.match(activity, /WindowInsetsCompat\.Type\.statusBars\(\)/);
  assert.match(activity, /setAppearanceLightStatusBars\(true\)/);
  assert.match(activity, /webView\.setBackgroundColor\(Color\.WHITE\)/);
  assert.match(activity, /setPadding\(/);
  assert.match(activity, /navigation-bar and IME insets/);
});
