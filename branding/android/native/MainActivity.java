package com.rayzeng.mocapstudio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState){
  registerPlugin(MoCapCameraPlugin.class);
  super.onCreate(savedInstanceState);
 }
}
