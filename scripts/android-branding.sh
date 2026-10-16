#!/usr/bin/env bash
set -euo pipefail
APP=android/app/src/main
PKG=$APP/java/com/rayzeng/mocapstudio
mkdir -p "$PKG" "$APP/res/drawable-nodpi"
cp branding/android/native/MainActivity.java "$PKG/MainActivity.java"
cp branding/android/native/MoCapCameraPlugin.java "$PKG/MoCapCameraPlugin.java"
cp branding/android/splash.jpg "$APP/res/drawable-nodpi/mocap_launch.jpg"
cp branding/android/icon.png "$APP/res/drawable-nodpi/mocap_icon.png"
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  dir="$APP/res/mipmap-$density"; mkdir -p "$dir"
  rm -f "$dir/ic_launcher.webp" "$dir/ic_launcher_round.webp"
  cp branding/android/icon.png "$dir/ic_launcher.png"
  cp branding/android/icon.png "$dir/ic_launcher_round.png"
done
mkdir -p "$APP/res/mipmap-anydpi-v26"
cat > "$APP/res/mipmap-anydpi-v26/ic_launcher.xml" <<'EOF'
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
 <background android:drawable="@android:color/black" />
 <foreground android:drawable="@drawable/mocap_icon" />
</adaptive-icon>
EOF
cp "$APP/res/mipmap-anydpi-v26/ic_launcher.xml" "$APP/res/mipmap-anydpi-v26/ic_launcher_round.xml"
# The full portrait poster is displayed in the HTML splash overlay. Native
# start screen uses a dark color, then loads the poster without cropping.
python3 - <<'PY2'
from pathlib import Path
p=Path('android/app/src/main/res/values/styles.xml')
s=p.read_text()
if 'name="AppTheme.NoActionBarLaunch"' in s:
 s=s.replace('@drawable/splash','@android:color/black')
 p.write_text(s)
PY2
