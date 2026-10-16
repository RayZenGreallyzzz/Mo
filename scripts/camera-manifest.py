from pathlib import Path
p=Path('android/app/src/main/AndroidManifest.xml')
s=p.read_text()
anchor='<application'
assert anchor in s
if 'android.permission.CAMERA' not in s:
 s=s.replace(anchor,'''<uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    '''+anchor,1)
p.write_text(s)
assert 'android.permission.CAMERA' in s
